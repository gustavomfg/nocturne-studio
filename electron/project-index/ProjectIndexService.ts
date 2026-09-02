import crypto from 'node:crypto'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { CODE_INTELLIGENCE_INDEX_VERSION } from '../../shared/codeIntelligence'
import { CODE_INTELLIGENCE_LIMITS } from '../../shared/constants'
import type {
  DiscoveredFile,
  ProjectIndexFile,
  ProjectIndexRun,
  ProjectIndexRunKind,
  ProjectIndexStatus,
  WorkspaceDiscoveryResult,
} from '../../shared/codeIntelligence'
import type { AwarenessContextSelection } from '../../shared/awareness'
import { isWorkspaceFileTooLarge, readWorkspaceFile } from '../security/ExecutionPolicy'
import { ProjectIndexRepository, type PersistedFileAnalysis } from '../database/ProjectIndexRepository'
import { WorkspaceDiscoveryService, isConfigurationFile } from './WorkspaceDiscoveryService'
import { ParserRegistry } from './ParserAdapter'
import type { ParsedFile } from './ParserAdapter'
import { TypeScriptParserAdapter } from './TypeScriptParserAdapter'
import { StackDetector } from './StackDetector'
import { resolveRelations } from './ProjectRelationResolver'

interface PendingChange {
  paths: Set<string>
  overflow: boolean
}

export interface ProjectIndexMetric {
  kind: 'index'
  workspace: string
  runId: string
  runKind: ProjectIndexRunKind
  durationMs: number
  processedFiles: number
  failedFiles: number
  unsupportedFiles: number
  incremental: boolean
  status: ProjectIndexRun['status']
  partialFailure: boolean
  parserDurationsMs: Record<string, number>
}

export interface ProjectIndexMetricsSnapshot {
  runs: number
  incrementalRuns: number
  cancellations: number
  partialFailures: number
  filesProcessed: number
  failedFiles: number
  unsupportedFiles: number
  totalDurationMs: number
  lastDurationMs: number | null
  lastIncrementalDurationMs: number | null
  parserDurationsMs: Record<string, number>
}

export interface ProjectIndexServiceOptions {
  discovery?: WorkspaceDiscoveryService
  stackDetector?: StackDetector
  parserRegistry?: ParserRegistry
  maxIndexedFileBytes?: number
  maxParseBytes?: number
  onStatus?(status: ProjectIndexStatus): void
  onMetric?(metric: ProjectIndexMetric): void
}

type FileProcessingResult = 'indexed' | 'unsupported' | 'failed' | 'skipped'

/** Coordinates discovery, parsing and persistence while keeping each file failure local. */
export class ProjectIndexService {
  private readonly discovery: WorkspaceDiscoveryService
  private readonly stackDetector: StackDetector
  private readonly parserRegistry: ParserRegistry
  private readonly maxIndexedFileBytes: number
  private readonly maxParseBytes: number
  private readonly running = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly currentPaths = new Map<string, string | null>()
  private readonly pending = new Map<string, PendingChange>()
  private readonly initialized = new Set<string>()
  private readonly metrics: ProjectIndexMetricsSnapshot = {
    runs: 0,
    incrementalRuns: 0,
    cancellations: 0,
    partialFailures: 0,
    filesProcessed: 0,
    failedFiles: 0,
    unsupportedFiles: 0,
    totalDurationMs: 0,
    lastDurationMs: null,
    lastIncrementalDurationMs: null,
    parserDurationsMs: {},
  }
  private disposed = false

  constructor(
    private readonly repository: ProjectIndexRepository,
    options: ProjectIndexServiceOptions = {},
  ) {
    this.discovery = options.discovery ?? new WorkspaceDiscoveryService()
    this.stackDetector = options.stackDetector ?? new StackDetector()
    this.parserRegistry = options.parserRegistry ?? new ParserRegistry([new TypeScriptParserAdapter()])
    this.maxIndexedFileBytes = options.maxIndexedFileBytes ?? CODE_INTELLIGENCE_LIMITS.maxIndexedFileBytes
    this.maxParseBytes = options.maxParseBytes ?? CODE_INTELLIGENCE_LIMITS.maxParseBytes
    this.onStatus = options.onStatus
    this.onMetric = options.onMetric
  }

  private readonly onStatus: ((status: ProjectIndexStatus) => void) | undefined
  private readonly onMetric: ((metric: ProjectIndexMetric) => void) | undefined

  ensureIndexed(workspace: string) {
    const normalizedWorkspace = path.resolve(workspace)
    if (this.disposed) return Promise.reject(new Error('O serviço de indexação já foi encerrado.'))
    if (!this.initialized.has(normalizedWorkspace)) {
      this.initialized.add(normalizedWorkspace)
      return this.schedule(normalizedWorkspace, 'initial', [], true)
    }
    return this.running.get(normalizedWorkspace) ?? Promise.resolve()
  }

  startManual(workspace: string) {
    return this.schedule(path.resolve(workspace), 'manual', [], true)
  }

  retryFailed(workspace: string) {
    const normalizedWorkspace = path.resolve(workspace)
    const paths = this.repository.listFiles(normalizedWorkspace).filter((file) => file.state === 'failed').map((file) => file.relativePath)
    return paths.length ? this.schedule(normalizedWorkspace, 'retry', paths, false) : Promise.resolve()
  }

  enqueueChange(event: { workspace: string; paths: string[]; overflow: boolean; error?: string }) {
    if (this.disposed || event.error) return
    const workspace = path.resolve(event.workspace)
    const pending = this.pending.get(workspace) ?? { paths: new Set<string>(), overflow: false }
    for (const changedPath of event.paths) pending.paths.add(changedPath.replace(/\\/g, '/'))
    pending.overflow ||= event.overflow
    this.pending.set(workspace, pending)
    if (this.initialized.has(workspace) && !this.running.has(workspace)) void this.schedulePending(workspace)
  }

  getStatus(workspace: string): ProjectIndexStatus | null {
    const run = this.repository.latestRun(path.resolve(workspace))
    if (!run) return null
    return { ...run, currentPath: this.currentPaths.get(path.resolve(workspace)) ?? null, cancelled: run.status === 'cancelled' }
  }

  getSummary(workspace: string) {
    return this.repository.summary(path.resolve(workspace))
  }

  getMetrics(): ProjectIndexMetricsSnapshot {
    return { ...this.metrics, parserDurationsMs: { ...this.metrics.parserDurationsMs } }
  }

  listFiles(workspace: string, limit?: number) {
    return this.repository.listFiles(path.resolve(workspace), limit)
  }

  listSymbols(workspace: string, query?: string, limit?: number) {
    return this.repository.listSymbols(path.resolve(workspace), query, limit)
  }

  listImports(workspace: string, relativePath?: string) {
    return this.repository.listImports(path.resolve(workspace), relativePath)
  }

  listExports(workspace: string, relativePath?: string) {
    return this.repository.listExports(path.resolve(workspace), relativePath)
  }

  listStackEvidence(workspace: string) {
    return this.repository.listStackEvidence(path.resolve(workspace))
  }

  listExclusions(workspace: string) {
    return this.repository.listExclusions(path.resolve(workspace))
  }

  buildAiContext(workspace: string, prompt: string) {
    const normalizedWorkspace = path.resolve(workspace)
    const summary = this.repository.summary(normalizedWorkspace)
    const run = summary.latestRun
    if (!run || !summary.files) return null
    const potentiallyOutdated = run.status !== 'completed' || Boolean(run.error) || this.pending.has(normalizedWorkspace)
    const tokens = new Set(prompt.toLocaleLowerCase().split(/[^\p{L}\p{N}_$]+/u).filter((token) => token.length >= 3))
    const indexedFiles = this.repository.listFiles(normalizedWorkspace).filter((file) => file.analyzedHash && ['indexed', 'unsupported'].includes(file.state)).slice(0, 16)
    const allSymbols = this.repository.listSymbols(normalizedWorkspace, '', 100)
    const symbols = allSymbols.filter((symbol) => {
      const haystack = `${symbol.name} ${symbol.qualifiedName ?? ''} ${symbol.relativePath}`.toLocaleLowerCase()
      return [...tokens].some((token) => haystack.includes(token))
    }).slice(0, 16)
    const selectedSymbols = symbols.length ? symbols : allSymbols.slice(0, 8)
    const selectedPaths = new Set(selectedSymbols.map((symbol) => symbol.relativePath))
    const imports = [...selectedPaths].flatMap((relativePath) => this.repository.listImports(normalizedWorkspace, relativePath)).slice(0, 24)
    const exports = [...selectedPaths].flatMap((relativePath) => this.repository.listExports(normalizedWorkspace, relativePath)).slice(0, 24)
    const lines = [
      `Índice estrutural v${summary.indexVersion}; execução ${run.id}; estado ${run.status}${run.error ? `; observação: ${run.error}` : ''}.`,
      `Arquivos: ${summary.files}; indexados: ${summary.indexedFiles}; falhos: ${summary.failedFiles}; não suportados: ${summary.unsupportedFiles}.`,
      `Stack: ${summary.stack?.stack.join(', ') || 'não detectado'}; linguagem primária: ${summary.stack?.primaryLanguage || 'desconhecida'}.`,
      ...indexedFiles.map((file) => `Arquivo ${file.relativePath} · estado ${file.state} · hash ${file.analyzedHash ?? 'não analisado'}.`),
      ...(summary.stack?.evidence.slice(0, 20).map((item) => `Evidência ${item.category}=${item.value} em ${item.sourcePath} (hash ${item.sourceHash}): ${item.reason}.`) ?? []),
      ...selectedSymbols.map((symbol) => `Símbolo ${symbol.kind} ${symbol.qualifiedName ?? symbol.name} em ${symbol.relativePath}:${symbol.location.startLine} (hash ${symbol.analyzedHash}; ${symbol.exported ? 'exportado' : 'não exportado'}).`),
      ...imports.map((relation) => `Import ${relation.sourcePath} → ${relation.targetPath ?? relation.specifier} em ${relation.location.startLine} (hash ${relation.sourceHash}; destino ${relation.targetHash ?? 'não analisado'}).`),
      ...exports.map((relation) => `Export ${relation.sourcePath} → ${relation.name}${relation.targetPath ? ` de ${relation.targetPath}` : ''} em ${relation.location.startLine} (hash ${relation.sourceHash}; destino ${relation.targetHash ?? 'não analisado'}).`),
    ]
    const text = lines.join('\n').slice(0, 40_000)
    const selections: AwarenessContextSelection[] = selectedSymbols.map((symbol) => ({
      id: `project-symbol:${symbol.id}`,
      title: `${symbol.name} · ${symbol.relativePath}`,
      source: 'project-index',
      sourceType: 'project-index',
      sourceId: symbol.id,
      kind: 'project-symbol',
      scope: 'workspace',
      relevance: tokens.size ? Math.min(100, 70 + [...tokens].filter((token) => `${symbol.name} ${symbol.relativePath}`.toLocaleLowerCase().includes(token)).length * 10) : 60,
      reason: `Símbolo recuperado do índice estrutural na execução ${run.id}.`,
      updatedAt: run.completedAt ?? run.updatedAt,
      contentPreview: `${symbol.kind} ${symbol.qualifiedName ?? symbol.name} · ${symbol.relativePath}:${symbol.location.startLine}`,
      analyzedHash: symbol.analyzedHash,
      indexVersion: summary.indexVersion,
      potentiallyOutdated,
    }))
    selections.push(...(summary.stack?.evidence.slice(0, 8).map((item) => ({
      id: `project-file:${item.id}`,
      title: `${item.value} · ${item.sourcePath}`,
      source: 'project-index' as const,
      sourceType: 'project-index' as const,
      sourceId: item.id,
      kind: 'project-file' as const,
      scope: 'workspace' as const,
      relevance: 65,
      reason: `${item.reason} (execução ${run.id}).`,
      updatedAt: item.detectedAt,
      contentPreview: `${item.category}=${item.value} · ${item.sourcePath}`,
      analyzedHash: item.sourceHash,
      indexVersion: summary.indexVersion,
      potentiallyOutdated,
    })) ?? []))
    return { text, selections, potentiallyOutdated, updatedAt: run.completedAt ?? run.updatedAt, runId: run.id, indexVersion: summary.indexVersion }
  }

  cancel(workspace: string) {
    const controller = this.controllers.get(path.resolve(workspace))
    if (!controller) return false
    controller.abort()
    return true
  }

  async dispose() {
    this.disposed = true
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.all([...this.running.values()].map((run) => run.catch(() => undefined)))
    this.running.clear()
    this.controllers.clear()
    this.pending.clear()
    this.currentPaths.clear()
  }

  private readonly schedule = (workspace: string, kind: ProjectIndexRunKind, paths: string[], overflow: boolean) => {
    const current = this.running.get(workspace)
    if (current) return current
    const operation = (async () => {
      let nextKind = kind
      let nextPaths = paths
      let nextOverflow = overflow
      while (!this.disposed) {
        await this.run(workspace, nextKind, nextPaths, nextOverflow)
        const change = this.pending.get(workspace)
        if (!change) break
        this.pending.delete(workspace)
        nextKind = change.overflow ? 'reconcile' : 'incremental'
        nextPaths = [...change.paths]
        nextOverflow = change.overflow
      }
    })().finally(() => { this.running.delete(workspace) })
    this.running.set(workspace, operation)
    return operation
  }

  private async schedulePending(workspace: string) {
    const change = this.pending.get(workspace)
    if (!change) return
    this.pending.delete(workspace)
    await this.schedule(workspace, change.overflow ? 'reconcile' : 'incremental', [...change.paths], change.overflow)
  }

  private async run(workspace: string, kind: ProjectIndexRunKind, requestedPaths: string[], overflow: boolean) {
    const runId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const run: ProjectIndexRun = {
      id: runId,
      workspace,
      indexVersion: CODE_INTELLIGENCE_INDEX_VERSION,
      kind,
      status: 'queued',
      phase: 'discovering',
      totalFiles: 0,
      processedFiles: 0,
      failedFiles: 0,
      unsupportedFiles: 0,
      pendingFiles: 0,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      error: null,
    }
    const controller = new AbortController()
    this.controllers.set(workspace, controller)
    const started = performance.now()
    this.repository.createRun(run)
    this.publish(run, null)
    const parserDurationsMs: Record<string, number> = {}
    try {
      run.status = 'running'
      this.updateRun(run, null)
      const fullDiscovery = overflow || kind === 'initial' || kind === 'reconcile' || kind === 'manual'
      const discovery = await this.discover(workspace, fullDiscovery ? undefined : requestedPaths, controller.signal)
      this.assertNotCancelled(controller.signal)
      run.phase = 'hashing'
      run.totalFiles = discovery.files.length
      run.pendingFiles = discovery.files.length
      this.updateRun(run, null)
      if (fullDiscovery) {
        this.repository.removeMissingFiles(workspace, discovery.files.map((file) => file.relativePath))
        this.repository.replaceExclusions(workspace, discovery.exclusions, discovery.completedAt)
      } else {
        this.repository.removeMissingForChange(workspace, requestedPaths, discovery.files.map((file) => file.relativePath))
        if (discovery.exclusions.length) this.repository.upsertExclusions(workspace, discovery.exclusions, discovery.completedAt)
      }
      const known = new Map(this.repository.listFiles(workspace).map((file) => [file.relativePath, file]))
      for (const file of discovery.files) {
        if (!known.has(file.relativePath)) known.set(file.relativePath, fileState(file, workspace, undefined, null, languageForPath(file.relativePath), 'discovered', null))
      }
      const failures: string[] = []
      for (const file of discovery.files) {
        this.assertNotCancelled(controller.signal)
        this.currentPaths.set(workspace, file.relativePath)
        run.phase = 'hashing'
        const result = await this.processFile(workspace, file, known, controller.signal, parserDurationsMs, kind === 'incremental')
        run.processedFiles += 1
        run.pendingFiles = Math.max(0, run.totalFiles - run.processedFiles)
        if (result === 'failed') {
          run.failedFiles += 1
          failures.push(file.relativePath)
        }
        if (result === 'unsupported') run.unsupportedFiles += 1
        run.phase = result === 'indexed' ? 'persisting' : 'hashing'
        this.updateRun(run, file.relativePath)
      }
      this.currentPaths.set(workspace, null)
      const shouldDetectStack = fullDiscovery || requestedPaths.some(isConfigurationFile)
      if (shouldDetectStack) {
        run.phase = 'parsing'
        this.updateRun(run, null)
        const stackDiscovery = fullDiscovery ? discovery : await this.discoverStackInputs(workspace, requestedPaths, controller.signal)
        const stack = await this.stackDetector.detect(workspace, stackDiscovery, controller.signal)
        this.repository.replaceStackEvidence(workspace, stack.evidence)
      }
      this.repository.refreshRelationHashes(workspace)
      run.status = 'completed'
      run.phase = 'completed'
      run.pendingFiles = 0
      run.completedAt = new Date().toISOString()
      run.error = discovery.truncated ? 'Indexação parcial: o limite de arquivos foi atingido.' : failures.length ? `Indexação parcial: ${failures.length} arquivo(s) falharam.` : null
      this.updateRun(run, null)
    } catch (error) {
      this.currentPaths.set(workspace, null)
      if (controller.signal.aborted || isAbortError(error)) {
        run.status = 'cancelled'
        run.phase = 'cancelled'
        run.completedAt = new Date().toISOString()
        run.error = 'Indexação cancelada pelo usuário.'
      } else {
        run.status = 'failed'
        run.phase = 'completed'
        run.completedAt = new Date().toISOString()
        run.error = errorText(error)
      }
      this.updateRun(run, null)
    } finally {
      this.controllers.delete(workspace)
      this.currentPaths.delete(workspace)
      this.recordMetric({
        kind: 'index',
        workspace,
        runId,
        runKind: kind,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        processedFiles: run.processedFiles,
        failedFiles: run.failedFiles,
        unsupportedFiles: run.unsupportedFiles,
        incremental: kind === 'incremental' || kind === 'retry',
        status: run.status,
        partialFailure: run.failedFiles > 0 || (run.status === 'completed' && Boolean(run.error)),
        parserDurationsMs,
      })
    }
  }

  private async discover(workspace: string, requestedPaths: string[] | undefined, signal: AbortSignal): Promise<WorkspaceDiscoveryResult> {
    this.assertNotCancelled(signal)
    const result = await this.discovery.discover(workspace, requestedPaths, signal)
    this.assertNotCancelled(signal)
    return result
  }

  private async discoverStackInputs(workspace: string, requestedPaths: string[], signal: AbortSignal): Promise<WorkspaceDiscoveryResult> {
    const indexedPaths = this.repository.listFiles(workspace)
      .filter((file) => file.classification === 'source' || file.classification === 'configuration' || file.classification === 'lockfile')
      .map((file) => file.relativePath)
    return this.discover(workspace, [...new Set([...indexedPaths, ...requestedPaths])], signal)
  }

  private async processFile(workspace: string, discovered: DiscoveredFile, known: Map<string, ProjectIndexFile>, signal: AbortSignal, parserDurationsMs: Record<string, number>, forceProcess = false): Promise<FileProcessingResult> {
    const previous = known.get(discovered.relativePath)
    const unchanged = !forceProcess && previous && previous.size === discovered.size && previous.mtimeMs === discovered.mtimeMs && previous.mode === discovered.mode
      && previous.analyzedHash && ['indexed', 'unsupported'].includes(previous.state)
    if (unchanged) {
      const refreshed = { ...previous, ctimeMs: discovered.ctimeMs, discoveredAt: new Date().toISOString(), error: null }
      this.repository.markFileState(refreshed)
      known.set(discovered.relativePath, refreshed)
      return 'skipped'
    }

    let content: Buffer
    let observedHash: string
    try {
      const result = await readWorkspaceFile(discovered.relativePath, workspace, this.maxIndexedFileBytes)
      content = result.content
      observedHash = hashBuffer(content)
    } catch (error) {
      const failed = fileState(discovered, workspace, previous, null, languageForPath(discovered.relativePath), 'failed', errorText(error))
      this.repository.markFileState(failed)
      known.set(discovered.relativePath, failed)
      return 'failed'
    }
    this.assertNotCancelled(signal)
    if (previous?.analyzedHash === observedHash && previous.state === 'failed') {
      // A retry gets a fresh parse attempt even when the bytes did not change.
    } else if (previous?.analyzedHash === observedHash && previous.state === 'indexed') {
      const refreshed = fileState(discovered, workspace, previous, observedHash, previous.language, 'indexed', null, previous.parserId, previous.parserVersion, previous.analyzedAt)
      this.repository.markFileState(refreshed)
      known.set(discovered.relativePath, refreshed)
      return 'skipped'
    }

    const adapter = this.parserRegistry.find(discovered.relativePath)
    const language = languageForPath(discovered.relativePath)
    if (!adapter) {
      const unsupported = fileState(discovered, workspace, previous, observedHash, language, 'unsupported', null, null, null, new Date().toISOString())
      this.repository.saveFileAnalysis({ file: unsupported, symbols: [], imports: [], exports: [] })
      known.set(discovered.relativePath, unsupported)
      return 'unsupported'
    }
    if (content.length > this.maxParseBytes) {
      const failed = fileState(discovered, workspace, previous, observedHash, language, 'failed', 'O arquivo excede o limite de parsing permitido.')
      this.repository.markFileState(failed)
      known.set(discovered.relativePath, failed)
      return 'failed'
    }

    let parsed: ParsedFile
    const parserStarted = performance.now()
    try {
      parsed = this.parserRegistry.parse(adapter, { relativePath: discovered.relativePath, content: content.toString('utf8') })
      parserDurationsMs[adapter.id] = (parserDurationsMs[adapter.id] ?? 0) + Math.max(0, Math.round(performance.now() - parserStarted))
    } catch (error) {
      parserDurationsMs[adapter.id] = (parserDurationsMs[adapter.id] ?? 0) + Math.max(0, Math.round(performance.now() - parserStarted))
      const failed = fileState(discovered, workspace, previous, observedHash, language, 'failed', errorText(error), adapter.id, adapter.version)
      this.repository.markFileState(failed)
      known.set(discovered.relativePath, failed)
      return 'failed'
    }

    try {
      const relations = resolveRelations({
        workspace,
        sourcePath: discovered.relativePath,
        sourceHash: observedHash,
        imports: parsed.imports,
        exports: parsed.exports,
        files: known,
      })
      const symbols = parsed.symbols.map((symbol, index) => ({
        ...symbol,
        id: stableId('symbol', workspace, discovered.relativePath, observedHash, `${symbol.kind}:${symbol.name}`, symbol.location.startLine, index),
        workspace,
        relativePath: discovered.relativePath,
        analyzedHash: observedHash,
        parserId: parsed.parserId,
        parserVersion: parsed.parserVersion,
      }))
      const indexed = fileState(discovered, workspace, previous, observedHash, parsed.language, 'indexed', null, parsed.parserId, parsed.parserVersion, new Date().toISOString())
      const analysis: PersistedFileAnalysis = { file: indexed, symbols, imports: relations.imports, exports: relations.exports }
      this.repository.saveFileAnalysis(analysis)
      known.set(discovered.relativePath, indexed)
      return 'indexed'
    } catch (error) {
      const failed = fileState(discovered, workspace, previous, observedHash, language, 'failed', errorText(error), adapter.id, adapter.version)
      this.repository.markFileState(failed)
      known.set(discovered.relativePath, failed)
      return 'failed'
    }
  }

  private updateRun(run: ProjectIndexRun, currentPath: string | null) {
    run.updatedAt = new Date().toISOString()
    this.repository.updateRun(run)
    this.publish(run, currentPath)
  }

  private publish(run: ProjectIndexRun, currentPath: string | null) {
    this.onStatus?.({ ...run, currentPath, cancelled: run.status === 'cancelled' })
  }

  private recordMetric(metric: ProjectIndexMetric) {
    this.metrics.runs += 1
    if (metric.incremental) this.metrics.incrementalRuns += 1
    if (metric.status === 'cancelled') this.metrics.cancellations += 1
    if (metric.partialFailure) this.metrics.partialFailures += 1
    this.metrics.filesProcessed += metric.processedFiles
    this.metrics.failedFiles += metric.failedFiles
    this.metrics.unsupportedFiles += metric.unsupportedFiles
    this.metrics.totalDurationMs += metric.durationMs
    this.metrics.lastDurationMs = metric.durationMs
    if (metric.incremental) this.metrics.lastIncrementalDurationMs = metric.durationMs
    for (const [parserId, durationMs] of Object.entries(metric.parserDurationsMs)) this.metrics.parserDurationsMs[parserId] = (this.metrics.parserDurationsMs[parserId] ?? 0) + durationMs
    this.onMetric?.(metric)
  }

  private assertNotCancelled(signal: AbortSignal) {
    if (signal.aborted) throw new Error('Indexação cancelada.')
  }
}

function fileState(
  discovered: DiscoveredFile,
  workspace: string,
  previous: ProjectIndexFile | undefined,
  observedHash: string | null,
  language: string,
  state: ProjectIndexFile['state'],
  error: string | null,
  parserId: string | null = previous?.parserId ?? null,
  parserVersion: string | null = previous?.parserVersion ?? null,
  analyzedAt: string | null = previous?.analyzedAt ?? null,
): ProjectIndexFile {
  return {
    workspace,
    relativePath: discovered.relativePath,
    classification: discovered.classification,
    language,
    extension: discovered.extension,
    size: discovered.size,
    mtimeMs: discovered.mtimeMs,
    ctimeMs: discovered.ctimeMs,
    mode: discovered.mode,
    observedHash,
    analyzedHash: state === 'failed' ? previous?.analyzedHash ?? null : observedHash,
    state,
    excluded: false,
    exclusionReason: null,
    parserId,
    parserVersion,
    error,
    discoveredAt: new Date().toISOString(),
    analyzedAt,
  }
}

function languageForPath(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase()
  return ({
    '.ts': 'TypeScript', '.tsx': 'TypeScript/JSX', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript/JSX', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.md': 'Markdown',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML', '.vue': 'Vue', '.svelte': 'Svelte',
  } as Record<string, string>)[extension] ?? (path.basename(relativePath).toLowerCase() === 'dockerfile' ? 'Dockerfile' : 'Desconhecida')
}

function hashBuffer(content: Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function stableId(kind: string, workspace: string, relativePath: string, hash: string, value: string, line: number, index: number) {
  return `${kind}-${crypto.createHash('sha256').update(`${workspace}\0${relativePath}\0${hash}\0${value}\0${line}\0${index}`).digest('hex').slice(0, 32)}`
}

function errorText(error: unknown) {
  if (isWorkspaceFileTooLarge(error)) return 'O arquivo excede o limite permitido para a indexação.'
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, CODE_INTELLIGENCE_LIMITS.maxErrorCharacters) || 'Falha desconhecida durante a indexação.'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.message === 'Indexação cancelada.'
}
