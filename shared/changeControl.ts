import type { AgentMode } from './suggestions'

export const executionStatuses = [
  'created',
  'planning',
  'running',
  'awaiting-review',
  'validating',
  'completed',
  'failed',
  'cancelled',
] as const

export type ExecutionStatus = typeof executionStatuses[number]

export const executionDecisions = [
  'pending',
  'accepted',
  'partially-accepted',
  'rejected',
  'reverted',
  'conflicted',
] as const

export type ExecutionDecision = typeof executionDecisions[number]

export const changeOperations = ['create', 'modify', 'delete', 'rename'] as const
export type ChangeOperation = typeof changeOperations[number]

export const changeStatuses = ['pending', 'accepted', 'rejected', 'edited', 'conflicted'] as const
export type ChangeStatus = typeof changeStatuses[number]

export const changeSetStatuses = ['pending', 'accepted', 'partially-accepted', 'rejected', 'conflicted'] as const
export type ChangeSetStatus = typeof changeSetStatuses[number]

export const hunkStatuses = ['pending', 'accepted', 'rejected', 'edited', 'conflicted'] as const
export type HunkStatus = typeof hunkStatuses[number]

export type ChangeOrigin =
  | 'codex-file-change'
  | 'codex-command'
  | 'validation'
  | 'documents'
  | 'manual'

export type ExecutionCommandSource = 'agent' | 'validation' | 'system'

export interface ExecutionRecord {
  id: string
  workspace: string
  conversationId: string
  prompt: string
  mode: AgentMode
  status: ExecutionStatus
  decision: ExecutionDecision
  retryOf: string | null
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface ExecutionCommandRecord {
  id: string
  executionId: string
  command: string
  args: string[]
  source: ExecutionCommandSource
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  exitCode: number | null
  durationMs: number | null
  outputSummary: string
  startedAt: string
  finishedAt: string | null
}

export interface ExecutionErrorRecord {
  id: string
  executionId: string
  stage: 'planning' | 'mutation' | 'validation' | 'decision' | 'rollback' | 'persistence'
  message: string
  path: string | null
  createdAt: string
}

export interface CheckpointRecord {
  id: string
  executionId: string
  workspace: string
  phase: 'before' | 'after'
  status: 'capturing' | 'ready' | 'failed'
  capturedAt: string
  rootPath: string
  error: string | null
}

export interface CheckpointFileRecord {
  id: string
  checkpointId: string
  relativePath: string
  exists: boolean
  kind: 'file' | 'directory' | 'symlink' | 'missing'
  size: number | null
  mode: number | null
  hash: string | null
  contentPath: string | null
}

export interface ChangeRecord {
  id: string
  executionId: string
  changeSetId: string
  checkpointId: string | null
  relativePath: string
  originalPath: string | null
  operation: ChangeOperation
  origin: ChangeOrigin
  beforeHash: string | null
  afterHash: string | null
  beforeSize: number | null
  afterSize: number | null
  status: ChangeStatus
  validationStatus: 'unknown' | 'pending' | 'passed' | 'failed' | 'blocked'
  createdAt: string
  updatedAt: string
}

export interface ChangeSetRecord {
  id: string
  executionId: string
  beforeCheckpointId: string
  afterCheckpointId: string
  status: ChangeSetStatus
  createdAt: string
  updatedAt: string
}

export interface ChangeHunkRecord {
  id: string
  changeId: string
  sequence: number
  baseHash: string
  originalPatch: string
  finalPatch: string
  status: HunkStatus
  startLine: number
  endLine: number
  decisionAt: string | null
}

export interface ExecutionValidationLink {
  executionId: string
  changeId: string | null
  validationId: string
  phase: 'before' | 'proposed' | 'after-decision'
}

export interface ExecutionOverview extends ExecutionRecord {
  changeCount: number
  validationCount: number
  checkpointCount: number
}
