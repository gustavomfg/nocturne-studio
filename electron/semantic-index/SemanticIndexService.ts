import crypto from 'node:crypto'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import type {
  SemanticEmbeddingSpace,
  SemanticIndexRun,
  SemanticIndexStatus,
  SemanticUnit,
} from '../../shared/semanticIndex'
import { SEMANTIC_CHUNK_STRATEGY_VERSION } from '../../shared/semanticIndex'
import type { ProjectIndexFileEvent, ProjectIndexService } from '../project-index/ProjectIndexService'
import { readWorkspaceFile } from '../security/ExecutionPolicy'
import { SemanticIndexRepository, type PersistedSemanticUnit } from '../database/SemanticIndexRepository'
import { chunkSemanticFile, type SemanticChunk } from './SemanticChunker'
import { SemanticPrivacyPolicy } from './SemanticPrivacyPolicy'

export interface SemanticEmbeddingResolution {
  space: SemanticEmbeddingSpace
  remote: boolean
  remoteAllowed: boolean
}

export interface SemanticEmbeddingOperations {
  resolve(workspace: string): Promise<SemanticEmbeddingResolution | null>
  embed(
    workspace: string,
    space: SemanticEmbeddingSpace,
    inputs: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[])[]>
}

export interface SemanticIndexMetric {
  kind: 'semantic-index'
  workspace: string
  runId: string
  incremental: boolean
  durationMs: number
  processedFiles: number
  indexedUnits: number
  lexicalOnlyUnits: number
  failedFiles: number
  excludedFiles: number
  cancelled: boolean
}

export interface SemanticIndexMetricsSnapshot {
  runs: number
  incrementalRuns: number
  cancellations: number
  partialFailures: number
  filesProcessed: number
  indexedUnits: number
  lexicalOnlyUnits: number
  failedFiles: number
  excludedFiles: number
  totalDurationMs: number
  lastDurationMs: number | null
  lastIncrementalDurationMs: number | null
}

export interface SemanticIndexServiceOptions {
  projectIndex: ProjectIndexService
  embeddings?: SemanticEmbeddingOperations
  privacyPolicy?: SemanticPrivacyPolicy
  onStatus?(status: SemanticIndexStatus): void
  onMetric?(metric: SemanticIndexMetric): void
}

interface PendingWorkspace {
  paths: Set<string>
  kind: SemanticIndexRun['kind']
}

type SemanticFileResult = 'indexed' | 'lexical-only' | 'failed' | 'excluded' | 'stale' | 'skipped'

/** Builds derived semantic units from Project Index rows without filesystem discovery. */
export class SemanticIndexService {
  private readonly running = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly pending = new Map<string, PendingWorkspace>()
  private disposed = false
  private readonly privacyPolicy: SemanticPrivacyPolicy
  private readonly metrics: SemanticIndexMetricsSnapshot = {
    runs: 0,
    incrementalRuns: 0,
    cancellations: 0,
    partialFailures: 0,
    filesProcessed: 0,
    indexedUnits: 0,
    lexicalOnlyUnits: 0,
    failedFiles: 0,
    excludedFiles: 0,
    totalDurationMs: 0,
    lastDurationMs: null,
    lastIncrementalDurationMs: null,
  }

  constructor(
    private readonly repository: SemanticIndexRepository,
    private readonly options: SemanticIndexServiceOptions,
  ) {
    this.privacyPolicy = options.privacyPolicy ?? new SemanticPrivacyPolicy()
  }

  async ensureIndexed(workspace: string) {
    const normalizedWorkspace = path.resolve(workspace)
    if (this.disposed) return Promise.reject(new Error('O serviço semântico já foi encerrado.'))
    const current = this.running.get(normalizedWorkspace)
    if (current) return current
    const paths = await this.pathsNeedingProcessing(normalizedWorkspace)
    const pending = this.pending.get(normalizedWorkspace)
    if (pending) {
      this.pending.delete(normalizedWorkspace)
      paths.push(...pending.paths)
    }
    const uniquePaths = [...new Set(paths)]
    if (!uniquePaths.length) return Promise.resolve()
    return this.schedule(normalizedWorkspace, pending?.kind ?? 'initial', uniquePaths)
  }

  enqueueFile(event: ProjectIndexFileEvent) {
    if (this.disposed) return
    const workspace = path.resolve(event.workspace)
    const pending = this.pending.get(workspace) ?? { paths: new Set<string>(), kind: 'incremental' as const }
    pending.paths.add(event.relativePath.replace(/\\/g, '/'))
    pending.kind = 'incremental'
    this.pending.set(workspace, pending)
    const projectStatus = this.options.projectIndex.getStatus(workspace)?.status
    if (!this.running.has(workspace) && projectStatus !== 'queued' && projectStatus !== 'running') void this.schedulePending(workspace)
  }

  enqueuePaths(workspace: string, paths: readonly string[]) {
    for (const relativePath of paths) this.enqueueFile({ workspace, relativePath, state: 'pending', analyzedHash: null, runId: 'filesystem-event' })
  }

  getStatus(workspace: string): SemanticIndexStatus | null {
    const run = this.repository.latestRun(path.resolve(workspace))
    if (!run) return null
    return { ...run, currentPath: null, cancelled: run.status === 'cancelled' }
  }

  getSummary(workspace: string) {
    return this.repository.summary(path.resolve(workspace))
  }

  getMetrics(): SemanticIndexMetricsSnapshot {
    return { ...this.metrics }
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
  }

  private schedule(workspace: string, kind: SemanticIndexRun['kind'], paths: readonly string[]) {
    const current = this.running.get(workspace)
    if (current) return current
    const operation = (async () => {
      let nextKind = kind
      let nextPaths = paths
      while (!this.disposed) {
        await this.run(workspace, nextKind, nextPaths)
        const next = this.pending.get(workspace)
        if (!next) return
        this.pending.delete(workspace)
        nextKind = next.kind
        nextPaths = [...next.paths]
      }
    })().finally(() => this.running.delete(workspace))
    this.running.set(workspace, operation)
    return operation
  }

  private async schedulePending(workspace: string) {
    const pending = this.pending.get(workspace)
    if (!pending) return
    this.pending.delete(workspace)
    await this.schedule(workspace, pending.kind, [...pending.paths])
  }

  private async run(workspace: string, kind: SemanticIndexRun['kind'], paths: readonly string[]) {
    const runId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const run: SemanticIndexRun = {
      id: runId,
      workspace,
      kind,
      status: 'queued',
      totalFiles: paths.length,
      processedFiles: 0,
      indexedUnits: 0,
      lexicalOnlyUnits: 0,
      failedFiles: 0,
      excludedFiles: 0,
      startedAt,
      completedAt: null,
      updatedAt: startedAt,
      error: null,
    }
    const controller = new AbortController()
    const started = performance.now()
    this.controllers.set(workspace, controller)
    this.repository.createRun(run)
    this.publish(run)
    try {
      run.status = 'running'
      this.updateRun(run)
      for (const relativePath of paths) {
        assertNotCancelled(controller.signal)
        let result: SemanticFileResult
        try {
          result = await this.processFile(workspace, relativePath, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) throw error
          this.repository.markFileStale(workspace, relativePath, errorText(error))
          result = 'failed'
        }
        run.processedFiles += 1
        if (result === 'indexed') run.indexedUnits += this.repository.listFileUnits(workspace, relativePath).length
        if (result === 'lexical-only') run.lexicalOnlyUnits += this.repository.listFileUnits(workspace, relativePath).length
        if (result === 'failed' || result === 'stale') run.failedFiles += 1
        if (result === 'excluded') run.excludedFiles += 1
        this.updateRun(run, relativePath)
      }
      run.status = 'completed'
      run.completedAt = new Date().toISOString()
      this.updateRun(run)
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed'
      run.completedAt = new Date().toISOString()
      run.error = controller.signal.aborted ? 'Indexação semântica cancelada pelo usuário.' : errorText(error)
      this.updateRun(run)
    } finally {
      this.controllers.delete(workspace)
      this.recordMetric({
        kind: 'semantic-index',
        workspace,
        runId,
        incremental: kind !== 'initial',
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        processedFiles: run.processedFiles,
        indexedUnits: run.indexedUnits,
        lexicalOnlyUnits: run.lexicalOnlyUnits,
        failedFiles: run.failedFiles,
        excludedFiles: run.excludedFiles,
        cancelled: run.status === 'cancelled',
      })
    }
  }

  private async processFile(workspace: string, relativePath: string, signal: AbortSignal): Promise<SemanticFileResult> {
    const file = this.options.projectIndex.getFile(workspace, relativePath)
    if (!file || file.state === 'deleted') {
      this.repository.deleteFile(workspace, relativePath)
      return 'skipped'
    }
    const embedding = await this.resolveEmbedding(workspace)
    const decision = this.privacyPolicy.evaluate(file, !embedding?.remote || embedding.remoteAllowed)
    if (!decision.allowed) {
      this.repository.deleteFile(workspace, relativePath)
      return 'excluded'
    }
    if (file.state === 'failed' || !file.analyzedHash) {
      this.repository.markFileStale(workspace, relativePath, file.error ?? 'O arquivo ainda não possui uma análise válida.')
      return 'failed'
    }

    const existing = this.repository.listFileUnits(workspace, relativePath)
    if (existing.length > 0 && existing.every((unit) => unit.sourceHash === file.analyzedHash
      && unit.chunkStrategyVersion === SEMANTIC_CHUNK_STRATEGY_VERSION
      && (unit.status === 'indexed' || unit.status === 'lexical-only')
      && (!embedding || sameSpace(unit.embeddingSpace, embedding.space) || lexicalFallbackMatches(unit, embedding)))) return 'skipped'

    const initial = await readWorkspaceFile(relativePath, workspace, WORKSPACE_READ_LIMITS.codeIndexBytes)
    const initialHash = hashBuffer(initial.content)
    if (initialHash !== file.analyzedHash) {
      this.repository.markFileStale(workspace, relativePath)
      this.enqueueFile({ workspace, relativePath, state: 'pending', analyzedHash: initialHash, runId: 'stale-check' })
      return 'stale'
    }
    assertNotCancelled(signal)
    const symbols = file.state === 'unsupported' ? [] : this.options.projectIndex.listSymbolsForFile(workspace, relativePath)
    const chunks = chunkSemanticFile({ file, content: initial.content.toString('utf8'), symbols })
    if (!chunks.length) {
      this.repository.deleteFile(workspace, relativePath)
      return 'excluded'
    }

    let vectors: readonly (readonly number[])[] | null = null
    let embeddingError: string | null = embedding && !decision.embeddingAllowed
      ? `${embeddingKey(embedding.space)}: ${decision.reason ?? 'Embedding não autorizado.'}`
      : null
    let resolvedEmbeddingSpace = embedding?.space ?? null
    if (embedding && decision.embeddingAllowed) {
      try {
        vectors = await this.options.embeddings?.embed(workspace, embedding.space, chunks.map(({ normalizedText }) => normalizedText), signal) ?? null
        const dimensions = vectors?.[0]?.length ?? embedding.space.dimensions
        if (dimensions < 1 || (vectors && (vectors.length !== chunks.length || vectors.some((vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))))) {
          throw new Error('O Provider retornou embeddings incompatíveis com o espaço configurado.')
        }
        resolvedEmbeddingSpace = { ...embedding.space, dimensions }
        const verification = await readWorkspaceFile(relativePath, workspace, WORKSPACE_READ_LIMITS.codeIndexBytes)
        if (hashBuffer(verification.content) !== file.analyzedHash) {
          this.repository.markFileStale(workspace, relativePath)
          this.enqueueFile({ workspace, relativePath, state: 'pending', analyzedHash: hashBuffer(verification.content), runId: 'stale-check' })
          return 'stale'
        }
      } catch (error) {
        if (signal.aborted) throw error
        embeddingError = `${embeddingKey(embedding.space)}: ${errorText(error)}`
        vectors = null
      }
    }

    const now = new Date().toISOString()
    const previousById = new Map(existing.map((unit) => [unit.id, unit]))
    const units: PersistedSemanticUnit[] = chunks.map((chunk, index) => toUnit(
      chunk,
      vectors?.[index] ?? null,
      vectors ? resolvedEmbeddingSpace : null,
      embeddingError,
      previousById.get(chunk.id),
      now,
    ))
    this.repository.replaceFileUnits(workspace, relativePath, units)
    return vectors ? 'indexed' : 'lexical-only'
  }

  private async resolveEmbedding(workspace: string) {
    if (!this.options.embeddings) return null
    try {
      return await this.options.embeddings.resolve(workspace)
    } catch {
      return null
    }
  }

  private async pathsNeedingProcessing(workspace: string) {
    const paths: string[] = []
    const files = this.options.projectIndex.listFiles(workspace)
    const embedding = await this.resolveEmbedding(workspace)
    for (const file of files) {
      const units = this.repository.listFileUnits(workspace, file.relativePath)
      const fallbackMatches = Boolean(embedding && units.length > 0 && units.every((unit) => lexicalFallbackMatches(unit, embedding)))
      if (!units.length || units.some((unit) => unit.sourceHash !== file.analyzedHash || unit.status === 'stale' || unit.status === 'incompatible' || (embedding && !sameSpace(unit.embeddingSpace, embedding.space) && !fallbackMatches))) paths.push(file.relativePath)
    }
    return paths
  }

  private updateRun(run: SemanticIndexRun, currentPath: string | null = null) {
    run.updatedAt = new Date().toISOString()
    this.repository.updateRun(run)
    this.publish(run, currentPath)
  }

  private publish(run: SemanticIndexRun, currentPath: string | null = null) {
    this.options.onStatus?.({ ...run, currentPath, cancelled: run.status === 'cancelled' })
  }

  private recordMetric(metric: SemanticIndexMetric) {
    this.metrics.runs += 1
    if (metric.incremental) this.metrics.incrementalRuns += 1
    if (metric.cancelled) this.metrics.cancellations += 1
    if (metric.failedFiles > 0) this.metrics.partialFailures += 1
    this.metrics.filesProcessed += metric.processedFiles
    this.metrics.indexedUnits += metric.indexedUnits
    this.metrics.lexicalOnlyUnits += metric.lexicalOnlyUnits
    this.metrics.failedFiles += metric.failedFiles
    this.metrics.excludedFiles += metric.excludedFiles
    this.metrics.totalDurationMs += metric.durationMs
    this.metrics.lastDurationMs = metric.durationMs
    if (metric.incremental) this.metrics.lastIncrementalDurationMs = metric.durationMs
    this.options.onMetric?.(metric)
  }
}

function toUnit(
  chunk: SemanticChunk,
  vector: readonly number[] | null,
  space: SemanticEmbeddingSpace | null,
  error: string | null,
  previous: SemanticUnit | undefined,
  now: string,
): PersistedSemanticUnit {
  return {
    ...chunk,
    embeddingSpace: space,
    status: vector ? 'indexed' : 'lexical-only',
    error,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    indexedAt: vector ? now : previous?.indexedAt ?? null,
    ...(vector ? { embedding: vector } : {}),
  }
}

function hashBuffer(content: Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function assertNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Indexação semântica cancelada.')
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 2_000) || 'Falha desconhecida durante a indexação semântica.'
}

function sameSpace(left: SemanticUnit['embeddingSpace'], right: SemanticEmbeddingSpace) {
  return Boolean(left
    && left.providerId === right.providerId
    && left.modelId === right.modelId
    && left.modelVersion === right.modelVersion
    // A provider may not advertise its output dimension until the first
    // response. In that case zero is an intentional wildcard, not a second
    // vector space.
    && (right.dimensions <= 0 || left.dimensions === right.dimensions))
}

function embeddingKey(space: SemanticEmbeddingSpace) {
  return `embedding:${space.providerId}/${space.modelId}@${space.modelVersion ?? 'unversioned'}`
}

function lexicalFallbackMatches(unit: SemanticUnit, embedding: SemanticEmbeddingResolution) {
  return unit.status === 'lexical-only' && unit.embeddingSpace === null && unit.error?.startsWith(embeddingKey(embedding.space)) === true
}
