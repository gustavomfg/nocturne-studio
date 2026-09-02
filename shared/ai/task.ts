import type { ModelCapability, ModelReference } from './model'

export const executionModes = ['build', 'review'] as const
export const contextSourceTypes = ['memory', 'project-index'] as const
export const modelRoles = ['default'] as const
export const taskOutputFormats = ['markdown'] as const

export const AI_TASK_LIMITS = {
  intentCharacters: 100_000,
  messages: 100,
  messageCharacters: 100_000,
  contextSources: 100,
  contextSourceCharacters: 100_000,
  totalContextCharacters: 500_000,
  constraints: 100,
  constraintCharacters: 4_000,
} as const

export type ExecutionMode = typeof executionModes[number]
export type ContextSourceType = typeof contextSourceTypes[number]
export type ModelRole = typeof modelRoles[number]
export type TaskOutputFormat = typeof taskOutputFormats[number]

export interface NormalizedMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ContextSource {
  id: string
  type: ContextSourceType
  title: string
  content: string
  scope: string
  relevance?: number
  updatedAt?: string
  potentiallyOutdated: boolean
}

export type TaskModelSelection =
  | { type: 'explicit'; model: ModelReference }
  | { type: 'workspace-default' }

export interface PermissionEnvelope {
  workspaceAccess: 'read-only' | 'workspace-write'
}

export interface NormalizedTaskInput {
  workspace: {
    id: string
    name: string
  }
  intent: string
  mode: ExecutionMode
  messages: NormalizedMessage[]
  context: ContextSource[]
  constraints: string[]
  requirements: ModelCapability[]
  selection: TaskModelSelection
  output: {
    format: TaskOutputFormat
  }
  permissions: PermissionEnvelope
  tools: []
}

export interface NormalizedTask extends NormalizedTaskInput {
  id: string
  createdAt: string
}
