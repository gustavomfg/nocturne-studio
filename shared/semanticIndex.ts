import type { ModelReference } from './ai/model'

export const SEMANTIC_INDEX_VERSION = 1
// Location accounting changed from slice-local to source-relative offsets.
// A new value forces persisted derived units to be rebuilt lazily.
export const SEMANTIC_CHUNK_STRATEGY_VERSION = 'symbols-v2'

export const semanticUnitKinds = [
  'symbol',
  'markdown-section',
  'configuration',
  'text',
] as const

export type SemanticUnitKind = typeof semanticUnitKinds[number]

export const semanticUnitStatuses = [
  'pending',
  'processing',
  'lexical-only',
  'indexed',
  'stale',
  'failed',
  'incompatible',
  'excluded',
] as const

export type SemanticUnitStatus = typeof semanticUnitStatuses[number]

export const semanticRunStatuses = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const

export type SemanticRunStatus = typeof semanticRunStatuses[number]

export interface SemanticEmbeddingSpace {
  providerId: string
  modelId: string
  modelVersion: string | null
  dimensions: number
}

export interface SemanticUnitLocation {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  startOffset?: number
  endOffset?: number
}

export interface SemanticUnit {
  id: string
  workspace: string
  relativePath: string
  kind: SemanticUnitKind
  language: string | null
  symbolId: string | null
  symbolName: string | null
  location: SemanticUnitLocation
  sourceHash: string
  chunkHash: string
  normalizedText: string
  chunkStrategyVersion: string
  embeddingSpace: SemanticEmbeddingSpace | null
  status: SemanticUnitStatus
  error: string | null
  createdAt: string
  updatedAt: string
  indexedAt: string | null
}

export interface SemanticIndexRun {
  id: string
  workspace: string
  kind: 'initial' | 'incremental' | 'rebuild' | 'retry'
  status: SemanticRunStatus
  totalFiles: number
  processedFiles: number
  indexedUnits: number
  lexicalOnlyUnits: number
  failedFiles: number
  excludedFiles: number
  startedAt: string
  completedAt: string | null
  updatedAt: string
  error: string | null
}

export interface SemanticIndexStatus extends SemanticIndexRun {
  currentPath: string | null
  cancelled: boolean
}

export interface SemanticIndexSummary {
  workspace: string
  indexVersion: number
  latestRun: SemanticIndexRun | null
  files: number
  units: number
  indexedUnits: number
  lexicalOnlyUnits: number
  staleUnits: number
  failedUnits: number
  excludedUnits: number
}

export interface SemanticSearchFilters {
  paths?: readonly string[]
  languages?: readonly string[]
  kinds?: readonly SemanticUnitKind[]
  symbols?: readonly string[]
}

export interface SemanticSearchQuery {
  workspace: string
  query: string
  limit?: number
  filters?: SemanticSearchFilters
  embeddingSpace?: SemanticEmbeddingSpace
}

export interface SemanticSearchScores {
  vector: number
  lexical: number
  structural: number
  dependency: number
  final: number
}

export interface SemanticSearchResult {
  unit: Pick<SemanticUnit, 'id' | 'relativePath' | 'kind' | 'language' | 'symbolId' | 'symbolName' | 'location' | 'sourceHash' | 'chunkHash' | 'status'>
  excerpt: string
  scores: SemanticSearchScores
  provenance: {
    indexVersion: number
    chunkStrategyVersion: string
    embeddingSpace: SemanticEmbeddingSpace | null
    reason: string
    /** Bounded currency of the candidate source, not a global workspace snapshot. */
    validity: 'current' | 'stale' | 'unknown'
    potentiallyOutdated: boolean
  }
}

export interface SemanticEmbeddingBinding {
  reference: ModelReference
  remoteAllowed: boolean
}
