import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { validationKinds, type StackEvidence, type ValidationArtifact, type ValidationKind, type ValidationRun } from '../../shared/codeIntelligence'
import { CODE_INTELLIGENCE_LIMITS } from '../../shared/constants'
import { assessCommand, resolveInsideWorkspace } from '../security/ExecutionPolicy'
import { redactLogText } from '../logging/Logger'
import type { ValidationRepository } from '../database/ValidationRepository'
import { CancellableProcessRunner, type ProcessRunner } from './CancellableProcessRunner'

export interface ValidationPlan {
  command: string
  args: string[]
  scriptCommand?: string
  reason: string
}

export interface ValidationMetric {
  kind: 'validation'
  workspace: string
  validationKind: ValidationKind
  status: ValidationRun['status']
  durationMs: number
}

export interface ValidationMetricsSnapshot {
  runs: number
  passed: number
  failed: number
  cancelled: number
  blocked: number
  totalDurationMs: number
  lastDurationMs: number | null
  byKind: Record<ValidationKind, { runs: number; durationMs: number }>
}

export interface ValidationPipelineOptions {
  runner?: ProcessRunner
  timeoutMs?: number
  onStatus?(run: ValidationRun): void
  onMetric?(metric: ValidationMetric): void
}

/** Plans and runs only stack-backed validation commands, preserving bounded diagnostics. */
export class ValidationPipeline {
  private readonly runner: ProcessRunner
  private readonly timeoutMs: number
  private readonly onStatus: ((run: ValidationRun) => void) | undefined
  private readonly onMetric: ((metric: ValidationMetric) => void) | undefined
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<ValidationRun> }>()
  private readonly metrics: ValidationMetricsSnapshot = {
    runs: 0,
    passed: 0,
    failed: 0,
    cancelled: 0,
    blocked: 0,
    totalDurationMs: 0,
    lastDurationMs: null,
    byKind: Object.fromEntries(validationKinds.map((kind) => [kind, { runs: 0, durationMs: 0 }])) as ValidationMetricsSnapshot['byKind'],
  }
  private disposed = false

  constructor(
    private readonly repository: ValidationRepository,
    private readonly stackEvidence: (workspace: string) => StackEvidence[],
    options: ValidationPipelineOptions = {},
  ) {
    this.runner = options.runner ?? new CancellableProcessRunner()
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.onStatus = options.onStatus
    this.onMetric = options.onMetric
  }

  run(workspace: string, kind: ValidationKind, executionId?: string) {
    const normalizedWorkspace = path.resolve(workspace)
    const current = this.active.get(normalizedWorkspace)
    if (current) return current.promise
    if (this.disposed) return Promise.reject(new Error('O pipeline de validação já foi encerrado.'))
    const controller = new AbortController()
    const promise = this.execute(normalizedWorkspace, kind, controller.signal, executionId)
      .finally(() => this.active.delete(normalizedWorkspace))
    this.active.set(normalizedWorkspace, { controller, promise })
    return promise
  }

  cancel(workspace: string) {
    const active = this.active.get(path.resolve(workspace))
    if (!active) return false
    active.controller.abort()
    return true
  }

  latest(workspace: string) {
    return this.repository.latest(path.resolve(workspace))
  }

  list(workspace: string, limit?: number) {
    return this.repository.list(path.resolve(workspace), limit)
  }

  getMetrics(): ValidationMetricsSnapshot {
    return { ...this.metrics, byKind: Object.fromEntries(validationKinds.map((kind) => [kind, { ...this.metrics.byKind[kind] }])) as ValidationMetricsSnapshot['byKind'] }
  }

  dispose() {
    this.disposed = true
    for (const active of this.active.values()) active.controller.abort()
    return Promise.all([...this.active.values()].map(({ promise }) => promise.catch(() => undefined))).then(() => undefined)
  }

  private async execute(workspace: string, kind: ValidationKind, signal: AbortSignal, executionId?: string): Promise<ValidationRun> {
    const startedAt = new Date().toISOString()
    const plan = planValidation(this.stackEvidence(workspace), kind)
    const run: ValidationRun = {
      id: crypto.randomUUID(),
      workspace,
      ...(executionId ? { executionId } : {}),
      kind,
      command: plan?.command ?? '',
      args: plan?.args ?? [],
      status: 'queued',
      exitCode: null,
      durationMs: null,
      outputSummary: '',
      artifacts: [],
      startedAt,
      completedAt: null,
      error: null,
    }
    this.repository.create(run)
    this.publish(run)
    const started = Date.now()

    if (!plan) {
      run.status = 'blocked'
      run.error = `Nenhum comando de ${kind} foi identificado nas evidências do stack.`
      run.completedAt = new Date().toISOString()
      run.durationMs = Math.max(0, Date.now() - started)
      this.repository.update(run)
      this.publish(run)
      this.metric(run)
      return run
    }

    const commandAssessment = assessCommand([plan.command, ...plan.args])
    const scriptAssessment = plan.scriptCommand ? assessCommand(plan.scriptCommand) : null
    if (commandAssessment.blockedAutomatic || scriptAssessment?.blockedAutomatic) {
      run.status = 'blocked'
      run.error = `Validação bloqueada por segurança: ${[...commandAssessment.reasons, ...(scriptAssessment?.reasons ?? [])].join('; ')}.`
      run.completedAt = new Date().toISOString()
      run.durationMs = Math.max(0, Date.now() - started)
      this.repository.update(run)
      this.publish(run)
      this.metric(run)
      return run
    }

    run.status = 'running'
    this.repository.update(run)
    this.publish(run)
    let result: Awaited<ReturnType<ProcessRunner['run']>>
    try {
      result = await this.runner.run(plan.command, plan.args, {
        cwd: workspace,
        signal,
        timeoutMs: this.timeoutMs,
        maxOutputCharacters: CODE_INTELLIGENCE_LIMITS.maxOutputCharacters,
      })
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed'
      run.durationMs = Math.max(0, Date.now() - started)
      run.completedAt = new Date().toISOString()
      run.error = signal.aborted ? 'Validação cancelada pelo usuário.' : sanitizeError(error instanceof Error ? error.message : String(error))
      this.repository.update(run)
      this.publish(run)
      this.metric(run)
      return run
    }
    run.exitCode = result.exitCode
    run.durationMs = result.durationMs
    run.outputSummary = summarizeOutput(result.stdout, result.stderr, result.truncated)
    run.artifacts = await discoverArtifacts(workspace, result.stdout, result.stderr)
    run.completedAt = new Date().toISOString()
    if (result.cancelled || signal.aborted) {
      run.status = 'cancelled'
      run.error = 'Validação cancelada pelo usuário.'
    } else if (result.timedOut) {
      run.status = 'failed'
      run.error = `Validação excedeu o limite de ${Math.round(this.timeoutMs / 1000)} segundos.`
    } else if (result.error) {
      run.status = 'failed'
      run.error = sanitizeError(result.error)
    } else if (result.exitCode === 0) {
      run.status = 'passed'
    } else {
      run.status = 'failed'
      run.error = result.exitCode === null ? 'O processo terminou sem código de saída.' : `O comando terminou com exit code ${result.exitCode}.`
    }
    this.repository.update(run)
    this.publish(run)
    this.metric(run)
    return run
  }

  private publish(run: ValidationRun) {
    this.onStatus?.({ ...run, args: [...run.args], artifacts: [...run.artifacts] })
  }

  private metric(run: ValidationRun) {
    const durationMs = run.durationMs ?? 0
    this.metrics.runs += 1
    if (run.status === 'passed') this.metrics.passed += 1
    if (run.status === 'failed') this.metrics.failed += 1
    if (run.status === 'cancelled') this.metrics.cancelled += 1
    if (run.status === 'blocked') this.metrics.blocked += 1
    this.metrics.totalDurationMs += durationMs
    this.metrics.lastDurationMs = durationMs
    this.metrics.byKind[run.kind].runs += 1
    this.metrics.byKind[run.kind].durationMs += durationMs
    this.onMetric?.({
      kind: 'validation',
      workspace: run.workspace,
      validationKind: run.kind,
      status: run.status,
      durationMs,
    })
  }
}

export function planValidation(evidence: readonly StackEvidence[], kind: ValidationKind): ValidationPlan | null {
  const scripts = new Map<string, { raw: string }>()
  for (const item of evidence) {
    if (item.category !== 'script') continue
    const separator = item.value.indexOf('=')
    if (separator <= 0) continue
    const name = item.value.slice(0, separator).trim()
    const command = item.value.slice(separator + 1).trim()
    if (/^[A-Za-z0-9_.:-]+$/.test(name) && command) scripts.set(name, { raw: command })
  }

  const scriptNames: Record<ValidationKind, string[]> = {
    typecheck: ['typecheck', 'type-check', 'check:types', 'types', 'check'],
    lint: ['lint', 'lint:check', 'check:lint', 'quality'],
    test: ['test', 'test:unit', 'test:ci', 'tests', 'check'],
    build: ['build', 'build:prod', 'compile', 'bundle'],
    smoke: ['smoke', 'smoke:test', 'e2e', 'test:e2e', 'healthcheck'],
  }
  const scriptEntry = scriptNames[kind].map((name) => [name, scripts.get(name)] as const).find(([, value]) => Boolean(value))
  const packageManager = detectPackageManager(evidence)
  if (scriptEntry?.[1]) {
    const [scriptName, script] = scriptEntry
    const invocation = packageManagerInvocation(packageManager, scriptName)
    return { ...invocation, scriptCommand: script.raw, reason: `Script ${scriptName} encontrado no projeto.` }
  }

  const languages = new Set(evidence.filter((item) => item.category === 'language').map((item) => item.value.toLowerCase()))
  const runtimes = new Set(evidence.filter((item) => item.category === 'runtime').map((item) => item.value.toLowerCase()))
  const values = new Set(evidence.map((item) => item.value.toLowerCase()))
  if (kind === 'typecheck' && (languages.has('typescript') || values.has('typescript'))) {
    return typecheckInvocation(packageManager)
  }
  if (kind === 'lint' && evidence.some((item) => item.category === 'lint')) {
    const tool = evidence.find((item) => item.category === 'lint')?.value.toLowerCase()
    if (tool === 'ruff') return { command: 'ruff', args: ['check', '.'], reason: 'Ruff foi detectado nas evidências do projeto.' }
    if (tool === 'biome') return { command: 'biome', args: ['check', '.'], reason: 'Biome foi detectado nas evidências do projeto.' }
    if (tool === 'oxlint') return { command: 'oxlint', args: ['.'], reason: 'oxlint foi detectado nas evidências do projeto.' }
    return { command: 'eslint', args: ['.'], reason: 'ESLint foi detectado nas evidências do projeto.' }
  }
  if (kind === 'test' && (runtimes.has('rust') || values.has('cargo test'))) return { command: 'cargo', args: ['test'], reason: 'Manifest Cargo e comando padrão de testes detectados.' }
  if (kind === 'build' && (runtimes.has('rust') || values.has('cargo build'))) return { command: 'cargo', args: ['build'], reason: 'Manifest Cargo e comando padrão de build detectados.' }
  if (kind === 'test' && (runtimes.has('go') || values.has('go test ./...'))) return { command: 'go', args: ['test', './...'], reason: 'Manifest Go e comando padrão de testes detectados.' }
  if (kind === 'build' && (runtimes.has('go') || values.has('go build ./...'))) return { command: 'go', args: ['build', './...'], reason: 'Manifest Go e comando padrão de build detectados.' }
  if (kind === 'test' && runtimes.has('python')) return { command: 'python', args: ['-m', 'pytest'], reason: 'Runtime Python e comando padrão pytest detectados.' }
  return null
}

function detectPackageManager(evidence: readonly StackEvidence[]) {
  const value = evidence.find((item) => item.category === 'package-manager')?.value.toLowerCase()
  if (value === 'pnpm') return 'pnpm'
  if (value === 'yarn') return 'yarn'
  if (value === 'bun') return 'bun'
  return 'npm'
}

function packageManagerInvocation(packageManager: string, script: string): ValidationPlan {
  const command = packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : packageManager === 'bun' ? 'bun' : 'npm'
  return { command, args: ['run', script], reason: `Script ${script} será executado pelo gerenciador detectado.` }
}

function typecheckInvocation(packageManager: string): ValidationPlan {
  if (packageManager === 'pnpm') return { command: 'pnpm', args: ['exec', 'tsc', '--noEmit'], reason: 'TypeScript detectado sem script explícito; usando o compilador local.' }
  if (packageManager === 'yarn') return { command: 'yarn', args: ['exec', 'tsc', '--noEmit'], reason: 'TypeScript detectado sem script explícito; usando o compilador local.' }
  if (packageManager === 'bun') return { command: 'bunx', args: ['--no-install', 'tsc', '--noEmit'], reason: 'TypeScript detectado sem script explícito; usando o compilador local.' }
  return { command: 'npx', args: ['--no-install', 'tsc', '--noEmit'], reason: 'TypeScript detectado sem script explícito; usando o compilador local.' }
}

function summarizeOutput(stdout: string, stderr: string, truncated: boolean) {
  const sections = [
    stdout.trim() ? `stdout:\n${sanitizeValidationText(stdout)}` : '',
    stderr.trim() ? `stderr:\n${sanitizeValidationText(stderr)}` : '',
  ].filter(Boolean)
  const summary = sections.join('\n\n').slice(0, CODE_INTELLIGENCE_LIMITS.maxOutputCharacters)
  return truncated ? `${summary}\n[saída truncada por limite]`.slice(0, CODE_INTELLIGENCE_LIMITS.maxOutputCharacters) : summary
}

async function discoverArtifacts(workspace: string, stdout: string, stderr: string): Promise<ValidationArtifact[]> {
  const canonicalWorkspace = fs.realpathSync.native(workspace)
  const candidates = new Set<string>()
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    for (const token of line.split(/\s+/)) {
      const candidate = token.replace(/^[([{"'`]+|[)\]},;:'"`]+$/g, '')
      if (!candidate || candidate.startsWith('-') || !/\.(?:json|xml|html?|log|txt|zip|tgz|png|snap|coverage)$/i.test(candidate)) continue
      candidates.add(candidate)
      if (candidates.size >= 40) break
    }
    if (candidates.size >= 40) break
  }
  const artifacts: ValidationArtifact[] = []
  for (const candidate of candidates) {
    if (artifacts.length >= 20) break
    try {
      const resolved = resolveInsideWorkspace(candidate, workspace)
      const stat = await fs.promises.stat(resolved)
      if (!stat.isFile()) continue
      const relativePath = path.relative(canonicalWorkspace, fs.realpathSync.native(resolved)).replace(/\\/g, '/')
      if (relativePath === '..' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) continue
      artifacts.push({ path: relativePath, kind: path.extname(resolved).slice(1).toLowerCase(), size: stat.size })
    } catch {
      // Output often contains labels or paths that were not materialized; those
      // are intentionally not persisted as artifacts.
    }
  }
  return artifacts
}

function sanitizeError(value: string) {
  return sanitizeValidationText(value).replace(/\s+/g, ' ').trim().slice(0, CODE_INTELLIGENCE_LIMITS.maxErrorCharacters) || 'Falha ao executar a validação.'
}

function sanitizeValidationText(value: string) {
  return redactLogText(value).replace(/\b(api[_-]?key|access[_-]?token|auth(?:orization)?|secret|password|credential)\s*([=:])\s*[^\s,;]+/gi, '$1$2[REDACTED]')
}
