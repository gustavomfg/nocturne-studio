export type EvidenceKind = 'context' | 'project-index' | 'semantic-index' | 'before' | 'after' | 'validation' | 'decision' | 'engineering'
export interface EvidenceReference { kind: string; id: string; payloadHash?: string }
export interface KnownWorkspacePath { path: string; hash: string | null; exists?: boolean }
export interface EvidenceVerification {
  checkedAt: string
  matchedPaths: number
  mismatchedPaths: number
  uncheckedPaths: number
}
export interface WorkspaceStateManifest {
  id: string
  workspace: string
  executionId: string | null
  kind: EvidenceKind
  sourceId: string
  startedAt: string
  observedAt: string
  consistency: 'non-atomic'
  coverage: 'known-paths-only'
  validity: 'unknown' | 'stale'
  staleDetectedAt: string | null
  reason: string | null
  truncated: boolean
  paths: KnownWorkspacePath[]
  references: EvidenceReference[]
  verification?: EvidenceVerification
}
