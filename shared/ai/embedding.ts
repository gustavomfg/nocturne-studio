import type { ModelDescriptor } from './model'

export const EMBEDDING_LIMITS = {
  maxInputsPerRequest: 128,
  maxInputCharacters: 32_000,
  maxTotalCharacters: 512_000,
  maxDimensions: 16_384,
} as const

export interface EmbeddingRequest {
  requestId: string
  model: ModelDescriptor
  inputs: readonly string[]
  dimensions?: number
}

export interface EmbeddingExecutionControl {
  signal: AbortSignal
}

export interface EmbeddingUsage {
  inputTokens?: number
  totalTokens?: number
}

export interface EmbeddingResult {
  requestId: string
  model: ModelDescriptor
  embeddings: readonly (readonly number[])[]
  dimensions: number
  usage?: EmbeddingUsage
}
