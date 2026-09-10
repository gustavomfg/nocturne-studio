import path from 'node:path'
import type {
  ProjectImport,
  ProjectIndexFile,
  ProjectIndexSummary,
  ProjectIndexRun,
  ValidationRun,
} from '../../shared/codeIntelligence'
import type { SemanticIndexSummary } from '../../shared/semanticIndex'
import {
  ENGINEERING_HEALTH_POLICY_VERSION,
  engineeringHealthCategories,
  type EngineeringEvidence,
  type EngineeringHealthSnapshot,
  type EngineeringSignal,
  type HealthCategoryResult,
} from '../../shared/engineeringIntelligence'
import type { EngineeringIntelligenceRepository } from '../database/EngineeringIntelligenceRepository'
import type { WorkspaceEvidenceRepository } from '../database/WorkspaceEvidenceRepository'
import { engineeringFingerprint } from './EngineeringFingerprint'
import { EngineeringHealthAnalyzer } from './EngineeringHealthAnalyzer'
import type { EngineeringInsightService } from './EngineeringInsightService'
import { EngineeringTrendService } from './EngineeringTrendService'

export interface EngineeringProjectIndexSource {
  getSummary(workspace: string): ProjectIndexSummary
  listFiles(workspace: string, limit?: number): ProjectIndexFile[]
  listImports(workspace: string, relativePath?: string): ProjectImport[]
}

export interface EngineeringValidationSource {
  list(workspace: string, limit?: number): ValidationRun[]
}

export interface EngineeringSemanticIndexSource {
  getSummary(workspace: string): SemanticIndexSummary
}

export interface EngineeringSignalMetric {
  kind: 'engineering-signal-engine'
  workspace: string
  durationMs: number
  signals: number
  assessedCategories: number
  partialCategories: number
  notAssessedCategories: number
}

export interface EngineeringSignalEngineMetrics {
  evaluations: number
  completed: number
  failed: number
  totalDurationMs: number
  lastDurationMs: number | null
  signalsProduced: number
  lastSignalsProduced: number
}

export interface EngineeringHealthEvaluation {
  snapshot: EngineeringHealthSnapshot
  signals: EngineeringSignal[]
  insights: ReturnType<EngineeringInsightService['generate']>
  trends: ReturnType<EngineeringTrendService['compare']>
}

export interface EngineeringSignalEngineOptions {
  now?: () => string
  onMetric?(metric: EngineeringSignalMetric): void
  healthAnalyzer?: EngineeringHealthAnalyzer
  insightService?: EngineeringInsightService
  trendService?: EngineeringTrendService
  semanticIndex?: EngineeringSemanticIndexSource
  workspaceEvidence?: Pick<WorkspaceEvidenceRepository, 'bySource'>
  executionIds?(workspace: string): string[]
  changeSetIds?(workspace: string): string[]
  onEvaluation?(evaluation: EngineeringHealthEvaluation): void
}

/** Computes evidence-backed findings without delegating metrics or scoring to an LLM. */
export class EngineeringSignalEngine {
  private readonly now: () => string
  private readonly onMetric: ((metric: EngineeringSignalMetric) => void) | undefined
  private readonly healthAnalyzer: EngineeringHealthAnalyzer
  private readonly insightService: EngineeringInsightService | undefined
  private readonly trendService: EngineeringTrendService
  private readonly semanticIndex: EngineeringSemanticIndexSource | undefined
  private readonly workspaceEvidence: Pick<WorkspaceEvidenceRepository, 'bySource'> | undefined
  private readonly executionIds: ((workspace: string) => string[]) | undefined
  private readonly changeSetIds: ((workspace: string) => string[]) | undefined
  private readonly onEvaluation: ((evaluation: EngineeringHealthEvaluation) => void) | undefined
  private readonly running = new Map<string, Promise<EngineeringHealthEvaluation>>()
  private readonly metrics: EngineeringSignalEngineMetrics = {
    evaluations: 0,
    completed: 0,
    failed: 0,
    totalDurationMs: 0,
    lastDurationMs: null,
    signalsProduced: 0,
    lastSignalsProduced: 0,
  }

  constructor(
    private readonly repository: EngineeringIntelligenceRepository,
    private readonly projectIndex: EngineeringProjectIndexSource,
    private readonly validation: EngineeringValidationSource,
    options: EngineeringSignalEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.onMetric = options.onMetric
    this.healthAnalyzer = options.healthAnalyzer ?? new EngineeringHealthAnalyzer()
    this.insightService = options.insightService
    this.trendService = options.trendService ?? new EngineeringTrendService()
    this.semanticIndex = options.semanticIndex
    this.workspaceEvidence = options.workspaceEvidence
    this.executionIds = options.executionIds
    this.changeSetIds = options.changeSetIds
    this.onEvaluation = options.onEvaluation
  }

  evaluate(workspace: string): Promise<EngineeringHealthEvaluation> {
    const normalizedWorkspace = path.resolve(workspace)
    const current = this.running.get(normalizedWorkspace)
    if (current) return current
    const operation = this.run(normalizedWorkspace).finally(() => this.running.delete(normalizedWorkspace))
    this.running.set(normalizedWorkspace, operation)
    return operation
  }

  getMetrics(): EngineeringSignalEngineMetrics {
    return { ...this.metrics }
  }

  async dispose() {
    await Promise.all([...this.running.values()].map((operation) => operation.catch(() => undefined)))
    this.running.clear()
  }

  private async run(workspace: string): Promise<EngineeringHealthEvaluation> {
    const started = Date.now()
    this.metrics.evaluations += 1
    try {
      const evaluatedAt = this.now()
      const projectSummary = this.projectIndex.getSummary(workspace)
      const projectFiles = this.projectIndex.listFiles(workspace)
      const imports = this.projectIndex.listImports(workspace)
      const validationRuns = this.validation.list(workspace, 100)
      const semanticSummary = this.semanticIndex?.getSummary(workspace)
      const project = assessArchitecture(workspace, projectSummary, projectFiles, imports, evaluatedAt)
      const validationObservations = latestValidationObservations(validationRuns, this.workspaceEvidence)
      const testing = assessTesting(validationObservations, evaluatedAt)
      const developerExperience = assessDeveloperExperience(validationObservations, evaluatedAt)
      const signals = [...project.signals, ...testing.signals, ...developerExperience.signals]
      const categories = [
        project.category,
        testing.category,
        emptyCategory('security', evaluatedAt),
        emptyCategory('documentation', evaluatedAt),
        emptyCategory('dependencies', evaluatedAt),
        emptyCategory('performance', evaluatedAt),
        developerExperience.category,
        emptyCategory('release', evaluatedAt),
      ]
      const previous = this.repository.latestSnapshot(workspace)
      const snapshot: EngineeringHealthSnapshot = this.healthAnalyzer.analyze({
        workspace,
        evaluatedAt,
        previousSnapshotId: previous?.id ?? null,
        sources: {
          projectIndexRunId: projectSummary.latestRun?.id ?? null,
          semanticIndexRunId: semanticSummary?.latestRun?.id ?? null,
          validationRunIds: validationRuns.map((run) => run.id),
          executionIds: this.executionIds?.(workspace) ?? [],
          changeSetIds: this.changeSetIds?.(workspace) ?? [],
        },
        categories,
        signals,
      })
      const activeSignals = this.repository.listSignals(workspace, 'active')
      const resolveValidationSignals = validationResolutionFingerprints(activeSignals, signals, validationRuns, validationObservations)
      const persistedSnapshot = this.repository.saveEvaluation(signals, snapshot, {
        skipCategoryResolution: ['testing', 'developer-experience'],
        resolveSignalFingerprints: resolveValidationSignals,
      })
      const insights = this.insightService?.generate(workspace, signals, evaluatedAt) ?? []
      const trends = this.trendService.compare(previous, persistedSnapshot)
      const durationMs = Math.max(0, Date.now() - started)
      this.metrics.completed += 1
      this.metrics.totalDurationMs += durationMs
      this.metrics.lastDurationMs = durationMs
      this.metrics.signalsProduced += signals.length
      this.metrics.lastSignalsProduced = signals.length
      this.onMetric?.({
        kind: 'engineering-signal-engine',
        workspace,
        durationMs,
        signals: signals.length,
        assessedCategories: categories.filter((category) => category.status === 'assessed').length,
        partialCategories: categories.filter((category) => category.status === 'partial').length,
        notAssessedCategories: categories.filter((category) => category.status === 'not-assessed').length,
      })
      const evaluation = { snapshot: persistedSnapshot, signals, insights, trends }
      this.onEvaluation?.(evaluation)
      return evaluation
    } catch (error) {
      this.metrics.failed += 1
      throw error
    }
  }
}

interface SignalAssessment {
  category: HealthCategoryResult
  signals: EngineeringSignal[]
}

interface ValidationObservation {
  run: ValidationRun
  evidence: EngineeringEvidence
  /** Null means this engine was constructed without an evidence source. */
  validity: EngineeringEvidence['validity'] | null
}

function assessArchitecture(
  workspace: string,
  summary: ProjectIndexSummary,
  files: readonly ProjectIndexFile[],
  imports: readonly ProjectImport[],
  evaluatedAt: string,
): SignalAssessment {
  const run = summary.latestRun
  if (!run) return { category: emptyCategory('architecture', evaluatedAt), signals: [] }
  const failedFiles = files.filter((file) => file.state === 'failed')
  const unresolvedImports = imports.filter((item) => item.resolution === 'unresolved')
  const signals = [
    failedFiles.length ? createIndexFailureSignal(workspace, run, failedFiles, evaluatedAt) : null,
    unresolvedImports.length ? createUnresolvedImportSignal(workspace, run, unresolvedImports, evaluatedAt) : null,
  ].filter((signal): signal is EngineeringSignal => signal !== null)
  const status = run.status === 'completed' ? 'assessed' : 'partial'
  const evidence = [
    runEvidence(run, `Execução do Project Index em estado ${run.status}.`),
    ...failedFiles.slice(0, 20).map((file) => fileEvidence(file, 'Arquivo não processado pelo parser.')),
    ...unresolvedImports.slice(0, 20).map((item) => importEvidence(item, run.updatedAt)),
  ]
  return {
    category: {
      category: 'architecture',
      status,
      score: null,
      coverage: { available: evidence.length, expected: summary.files || null, percent: null },
      signalIds: signals.map((signal) => signal.id),
      evidence: deduplicateEvidence(evidence),
      evaluatedAt,
    },
    signals,
  }
}

function assessTesting(observations: readonly ValidationObservation[], evaluatedAt: string): SignalAssessment {
  if (!observations.length) return { category: emptyCategory('testing', evaluatedAt), signals: [] }
  const concreteRuns = observations.filter(({ run }) => run.status === 'passed' || (run.status === 'failed' && !isEnvironmentFailure(run)))
  const signals = deduplicateSignals(observations
    .filter(({ run, validity }) => run.status === 'failed' && !isEnvironmentFailure(run) && validity !== 'stale')
    .slice(0, 20)
    .map(({ run, evidence }) => createValidationFailureSignal(run, evidence)))
  const evidence = observations.slice(0, 20).map(({ evidence }) => evidence)
  const incomplete = observations.some(({ run, validity }) => !isConcreteValidation(run) || validity === 'stale' || validity === 'unknown')
  return {
    category: {
      category: 'testing',
      status: concreteRuns.length && !incomplete ? 'assessed' : 'partial',
      score: null,
      coverage: { available: evidence.length, expected: null, percent: null },
      signalIds: signals.map((signal) => signal.id),
      evidence,
      evaluatedAt,
    },
    signals,
  }
}

function assessDeveloperExperience(observations: readonly ValidationObservation[], evaluatedAt: string): SignalAssessment {
  const blocked = observations.filter(({ run }) => run.status === 'blocked' || (run.status === 'failed' && isEnvironmentFailure(run))).slice(0, 20)
  if (!blocked.length) return { category: emptyCategory('developer-experience', evaluatedAt), signals: [] }
  const signals = deduplicateSignals(blocked.filter(({ validity }) => validity !== 'stale').map(({ run, evidence }) => createValidationEnvironmentSignal(run, evidence)))
  const evidence = blocked.map(({ evidence }) => evidence)
  return {
    category: {
      category: 'developer-experience',
      status: 'partial',
      score: null,
      coverage: { available: evidence.length, expected: null, percent: null },
      signalIds: signals.map((signal) => signal.id),
      evidence,
      evaluatedAt,
    },
    signals,
  }
}

function emptyCategory(category: (typeof engineeringHealthCategories)[number], evaluatedAt: string): HealthCategoryResult {
  return {
    category,
    status: 'not-assessed',
    score: null,
    coverage: { available: 0, expected: null, percent: null },
    signalIds: [],
    evidence: [],
    evaluatedAt,
  }
}

function createIndexFailureSignal(workspace: string, run: ProjectIndexRun, files: readonly ProjectIndexFile[], detectedAt: string): EngineeringSignal {
  const evidence = files.slice(0, 20).map((file) => fileEvidence(file, 'Arquivo permaneceu em estado de falha após a indexação.'))
  return createSignal(workspace, 'project-index-failure', 'Falha parcial no índice estrutural', `${files.length} arquivo(s) não puderam ser processado(s) pelo Project Index.`, 'medium', evidence, { name: 'failedFiles', value: files.length, unit: 'files' }, detectedAt, { runId: run.id, stableKey: 'failed-files' })
}

function createUnresolvedImportSignal(workspace: string, run: ProjectIndexRun, imports: readonly ProjectImport[], detectedAt: string): EngineeringSignal {
  const evidence = imports.slice(0, 20).map((item) => importEvidence(item, run.updatedAt))
  return createSignal(workspace, 'unresolved-local-import', 'Referências locais não resolvidas', `${imports.length} relação(ões) de import/export não foram resolvidas pelo Project Index.`, imports.length >= 10 ? 'medium' : 'low', evidence, { name: 'unresolvedImports', value: imports.length, unit: 'relations' }, detectedAt, { runId: run.id, stableKey: 'unresolved-imports' })
}

function createValidationFailureSignal(run: ValidationRun, evidence = validationEvidence(run)): EngineeringSignal {
  return createSignal(run.workspace, `validation-failure-${run.kind}`, `Validação ${run.kind} falhou`, `A validação ${run.kind} terminou com falha concreta do projeto.`, 'medium', [evidence], { name: 'exitCode', value: run.exitCode, unit: 'process' }, run.completedAt ?? run.startedAt, { stableKey: run.kind })
}

function createValidationEnvironmentSignal(run: ValidationRun, evidence = validationEvidence(run)): EngineeringSignal {
  return createSignal(run.workspace, `validation-environment-${run.kind}`, `Validação ${run.kind} indisponível`, `A validação ${run.kind} não foi executada por uma condição do ambiente ou da política local.`, 'info', [evidence], { name: 'status', value: run.status }, run.completedAt ?? run.startedAt, { stableKey: `${run.kind}:${environmentReason(run)}` })
}

function createSignal(
  workspace: string,
  kind: string,
  title: string,
  description: string,
  severity: EngineeringSignal['severity'],
  evidence: EngineeringEvidence[],
  metric: EngineeringSignal['metric'],
  detectedAt: string,
  options: { runId?: string; stableKey?: string } = {},
): EngineeringSignal {
  const normalizedEvidence = deduplicateEvidence(evidence).slice(0, 20)
  const signalFingerprint = engineeringFingerprint({
    policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
    category: kind.startsWith('validation-') ? (kind.startsWith('validation-environment') ? 'developer-experience' : 'testing') : 'architecture',
    kind,
    stableKey: options.stableKey ?? null,
  })
  const confidence = evidenceQuality(normalizedEvidence)
  return {
    id: `engineering-signal-${signalFingerprint}`,
    workspace,
    category: kind.startsWith('validation-') ? (kind.startsWith('validation-environment') ? 'developer-experience' : 'testing') : 'architecture',
    kind,
    title,
    description,
    severity,
    confidence,
    evidence: normalizedEvidence,
    metric,
    source: 'deterministic',
    policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
    detectedAt,
    fingerprint: signalFingerprint,
    status: 'active',
    firstSeenAt: detectedAt,
    lastSeenAt: detectedAt,
    resolvedAt: null,
  }
}

function runEvidence(run: ProjectIndexRun, detail: string): EngineeringEvidence {
  return { id: `project-index-run:${run.id}`, source: 'project-index-run', sourceId: run.id, runId: run.id, detail, observedAt: run.completedAt ?? run.updatedAt }
}

function fileEvidence(file: ProjectIndexFile, detail: string): EngineeringEvidence {
  return {
    id: `project-index-file:${file.workspace}:${file.relativePath}`,
    source: 'project-index-file',
    sourceId: `${file.workspace}:${file.relativePath}`,
    relativePath: file.relativePath,
    ...(file.analyzedHash || file.observedHash ? { sourceHash: file.analyzedHash ?? file.observedHash! } : {}),
    detail,
    observedAt: file.analyzedAt ?? file.discoveredAt,
  }
}

function importEvidence(item: ProjectImport, observedAt: string): EngineeringEvidence {
  return {
    id: `project-index-import:${item.id}`,
    source: 'project-import',
    sourceId: item.id,
    relativePath: item.sourcePath,
    sourceHash: item.sourceHash,
    location: item.location,
    detail: `Relação para ${item.specifier} permaneceu ${item.resolution}.`,
    observedAt,
  }
}

function validationEvidence(run: ValidationRun, validity?: EngineeringEvidence['validity']): EngineeringEvidence {
  return {
    id: `validation-run:${run.id}`,
    source: 'validation-run',
    sourceId: run.id,
    runId: run.id,
    ...(validity ? { validity } : {}),
    detail: `Validação ${run.kind} terminou com status ${run.status}${run.exitCode === null ? '' : ` e exit code ${run.exitCode}`}.`,
    observedAt: run.completedAt ?? run.startedAt,
  }
}

function latestValidationObservations(
  runs: readonly ValidationRun[],
  workspaceEvidence?: Pick<WorkspaceEvidenceRepository, 'bySource'>,
): ValidationObservation[] {
  const ordered = [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id))
  const latest = new Map<string, ValidationRun>()
  for (const run of ordered) {
    const key = validationComparisonKey(run)
    if (!latest.has(key)) latest.set(key, run)
  }
  return [...latest.values()].map((run) => {
    const manifest = workspaceEvidence?.bySource('validation', run.id)
    const validity = workspaceEvidence ? (manifest?.validity ?? 'unknown') : null
    return { run, validity, evidence: validationEvidence(run, validity ?? undefined) }
  })
}

function validationComparisonKey(run: Pick<ValidationRun, 'kind' | 'command' | 'args'>): string {
  return JSON.stringify({ kind: run.kind, command: run.command, args: run.args })
}

function isConcreteValidation(run: ValidationRun): boolean {
  return run.status === 'passed' || (run.status === 'failed' && !isEnvironmentFailure(run))
}

function validationResolutionFingerprints(
  activeSignals: readonly EngineeringSignal[],
  currentSignals: readonly EngineeringSignal[],
  allRuns: readonly ValidationRun[],
  observations: readonly ValidationObservation[],
): string[] {
  const currentFingerprints = new Set(currentSignals.map((signal) => signal.fingerprint))
  const runsById = new Map(allRuns.map((run) => [run.id, run]))
  const latestByKey = new Map(observations.map((observation) => [validationComparisonKey(observation.run), observation]))
  const resolved = new Set<string>()
  for (const signal of activeSignals) {
    if (signal.category !== 'testing' && signal.category !== 'developer-experience') continue
    const source = signal.evidence.find((item) => item.source === 'validation-run' && (item.runId || item.sourceId))
    const previousRun = source?.runId ? runsById.get(source.runId) : source ? runsById.get(source.sourceId) : undefined
    if (!previousRun) continue
    const current = latestByKey.get(validationComparisonKey(previousRun))
    if (!current || !isConcreteValidation(current.run)) continue
    if (current.run.id === previousRun.id && currentFingerprints.has(signal.fingerprint)) continue
    // A stale manifest cannot establish that the newer command observed a comparable state.
    if (current.validity === 'stale') continue
    resolved.add(signal.fingerprint)
  }
  return [...resolved]
}

function evidenceQuality(evidence: readonly EngineeringEvidence[]): number {
  if (!evidence.length) return 0
  const withHash = evidence.filter((item) => item.sourceHash).length
  return Math.min(100, 60 + Math.round((withHash / evidence.length) * 40))
}

function deduplicateEvidence(evidence: readonly EngineeringEvidence[]): EngineeringEvidence[] {
  return [...new Map(evidence.map((item) => [item.id, item])).values()]
}

function deduplicateSignals(signals: readonly EngineeringSignal[]): EngineeringSignal[] {
  return [...new Map(signals.map((signal) => [signal.fingerprint, signal])).values()]
}

function isEnvironmentFailure(run: ValidationRun): boolean {
  const message = (run.error ?? '').toLocaleLowerCase()
  return /enoent|spawn|permission denied|not found|não encontrado|nenhum comando|bloquead/.test(message)
}

function environmentReason(run: ValidationRun): string {
  return `${run.status}:${isEnvironmentFailure(run) ? 'environment' : 'policy'}`
}
