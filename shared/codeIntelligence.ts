export const CODE_INTELLIGENCE_INDEX_VERSION = 1

export type DiscoveryFileClassification = 'source' | 'configuration' | 'documentation' | 'lockfile' | 'asset' | 'unknown'
export type ProjectIndexFileState = 'discovered' | 'pending' | 'processing' | 'indexed' | 'unsupported' | 'failed' | 'deleted' | 'excluded'
export type ProjectIndexRunKind = 'initial' | 'incremental' | 'reconcile' | 'retry' | 'manual'
export type ProjectIndexRunStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
export type ProjectIndexPhase = 'discovering' | 'hashing' | 'parsing' | 'persisting' | 'completed' | 'cancelled'

export interface DiscoveredFile {
  relativePath: string
  classification: DiscoveryFileClassification
  extension: string
  size: number
  mtimeMs: number
  ctimeMs: number
  mode: number
}

export interface DiscoveryExclusion {
  relativePath: string
  reason: string
}

export interface WorkspaceDiscoveryResult {
  workspace: string
  files: DiscoveredFile[]
  configurationFiles: string[]
  exclusions: DiscoveryExclusion[]
  missingPaths: string[]
  completedAt: string
  truncated: boolean
}

export interface ProjectIndexFile {
  workspace: string
  relativePath: string
  classification: DiscoveryFileClassification
  language: string
  extension: string
  size: number
  mtimeMs: number
  ctimeMs: number
  mode: number
  observedHash: string | null
  analyzedHash: string | null
  state: ProjectIndexFileState
  excluded: boolean
  exclusionReason: string | null
  parserId: string | null
  parserVersion: string | null
  error: string | null
  discoveredAt: string
  analyzedAt: string | null
}

export interface ProjectIndexRun {
  id: string
  workspace: string
  indexVersion: number
  kind: ProjectIndexRunKind
  status: ProjectIndexRunStatus
  phase: ProjectIndexPhase
  totalFiles: number
  processedFiles: number
  failedFiles: number
  unsupportedFiles: number
  pendingFiles: number
  startedAt: string
  updatedAt: string
  completedAt: string | null
  error: string | null
}

export interface ProjectIndexStatus extends ProjectIndexRun {
  currentPath: string | null
  cancelled: boolean
}

export type ProjectSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'component' | 'method' | 'variable' | 'namespace' | 'unknown'

export interface SymbolLocation {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface ProjectSymbol {
  id: string
  workspace: string
  relativePath: string
  analyzedHash: string
  kind: ProjectSymbolKind
  name: string
  qualifiedName: string | null
  scope: string | null
  signature: string | null
  location: SymbolLocation
  exported: boolean
  parserId: string
  parserVersion: string
}

export type ProjectImportKind = 'default' | 'named' | 'namespace' | 'side-effect' | 'require' | 'dynamic'
export type ProjectExportKind = 'named' | 'default' | 'all' | 're-export'

export interface ProjectImport {
  id: string
  workspace: string
  sourcePath: string
  sourceHash: string
  specifier: string
  targetPath: string | null
  targetHash: string | null
  kind: ProjectImportKind
  importedNames: string[]
  location: SymbolLocation
  resolution: 'local' | 'external' | 'unresolved'
}

export interface ProjectExport {
  id: string
  workspace: string
  sourcePath: string
  sourceHash: string
  name: string
  kind: ProjectExportKind
  targetPath: string | null
  targetHash: string | null
  location: SymbolLocation
}

export type StackEvidenceCategory = 'language' | 'runtime' | 'framework' | 'bundler' | 'package-manager' | 'typecheck' | 'lint' | 'test' | 'build' | 'convention' | 'script'

export interface StackEvidence {
  id: string
  workspace: string
  category: StackEvidenceCategory
  value: string
  confidence: number
  sourcePath: string
  sourceHash: string
  sourceLine: number | null
  reason: string
  detectedAt: string
}

export interface DetectedStack {
  name: string
  stack: string[]
  primaryLanguage: string
  commands: Record<string, string>
  evidence: StackEvidence[]
  detectedAt: string
}

export interface ProjectIndexSummary {
  workspace: string
  indexVersion: number
  latestRun: ProjectIndexRun | null
  files: number
  indexedFiles: number
  failedFiles: number
  unsupportedFiles: number
  symbols: number
  imports: number
  exports: number
  stack: DetectedStack | null
}

export interface ProjectIndexQuery {
  workspace: string
  query?: string
  limit?: number
}

export const validationKinds = ['typecheck', 'lint', 'test', 'build', 'smoke'] as const
export type ValidationKind = typeof validationKinds[number]
export type ValidationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'blocked'

export interface ValidationArtifact {
  path: string
  kind: string
  size: number | null
}

export interface ValidationRun {
  id: string
  workspace: string
  kind: ValidationKind
  command: string
  args: string[]
  status: ValidationStatus
  exitCode: number | null
  durationMs: number | null
  outputSummary: string
  artifacts: ValidationArtifact[]
  startedAt: string
  completedAt: string | null
  error: string | null
}
