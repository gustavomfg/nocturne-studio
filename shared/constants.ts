export const DATABASE_SCHEMA_VERSION = 15

export const RENDERER_LIMITS = {
  activities: 300,
  activityDetailCharacters: 64_000,
  chatMessages: 200,
  streamCharacters: 2_000_000,
} as const

export const PERSISTENCE_LIMITS = {
  assistantCharacters: 2_000_000,
  documentCharacters: 2_000_000,
  documentNameCharacters: 200,
} as const

/**
 * Byte limits for files read from an authorized workspace by the main process.
 * These are deliberately separate from character limits: UTF-8 characters do
 * not have a fixed byte width and the I/O boundary must be enforced first.
 */
export const WORKSPACE_READ_LIMITS = Object.freeze({
  attachmentBytes: 1_000_000,
  workspaceContextBytes: 256_000,
  projectMetadataBytes: 256_000,
  packageMetadataBytes: 1_000_000,
  suggestionHistoryBytes: 1_000_000,
  documentBytes: 2_000_000,
})

export const UI_TIMING = {
  streamFlushMs: 80,
  activityFlushMs: 150,
  diagnosticsIntervalMs: 10_000,
} as const

export const RENDERER_PERFORMANCE_BUDGETS = {
  startupMs: 5_000,
  conversationLoadMs: 2_000,
  longTaskMs: 50,
} as const

export const COLLECTION_PAGE_LIMITS = { conversations: 100, artifacts: 50, suggestions: 50, brainMemories: 50 } as const
