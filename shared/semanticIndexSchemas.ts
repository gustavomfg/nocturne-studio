import { z } from 'zod'
import { modelReferenceSchema } from './ai/modelSchemas'
import {
  SEMANTIC_CHUNK_STRATEGY_VERSION,
  SEMANTIC_INDEX_VERSION,
  semanticUnitKinds,
  semanticUnitStatuses,
} from './semanticIndex'

const pathSchema = z.string().trim().min(1).max(4_000)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/i)
const locationSchema = z.object({
  startLine: z.number().int().min(1),
  startColumn: z.number().int().min(1),
  endLine: z.number().int().min(1),
  endColumn: z.number().int().min(1),
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
}).strict()

export const semanticEmbeddingSpaceSchema = z.object({
  providerId: z.string().trim().min(1).max(512),
  modelId: z.string().trim().min(1).max(512),
  modelVersion: z.string().trim().min(1).max(200).nullable(),
  dimensions: z.number().int().positive().max(16_384),
}).strict()

export const semanticUnitSchema = z.object({
  id: z.string().trim().min(1).max(1_000),
  workspace: pathSchema,
  relativePath: pathSchema,
  kind: z.enum(semanticUnitKinds),
  language: z.string().trim().min(1).max(100).nullable(),
  symbolId: z.string().trim().min(1).max(1_000).nullable(),
  symbolName: z.string().trim().min(1).max(1_000).nullable(),
  location: locationSchema,
  sourceHash: hashSchema,
  chunkHash: hashSchema,
  normalizedText: z.string().min(1).max(100_000),
  chunkStrategyVersion: z.string().trim().min(1).max(100),
  embeddingSpace: semanticEmbeddingSpaceSchema.nullable(),
  status: z.enum(semanticUnitStatuses),
  error: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  indexedAt: z.string().datetime({ offset: true }).nullable(),
}).strict()

export const semanticSearchFiltersSchema = z.object({
  paths: z.array(pathSchema).max(100).optional(),
  languages: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  kinds: z.array(z.enum(semanticUnitKinds)).max(10).optional(),
  symbols: z.array(z.string().trim().min(1).max(1_000)).max(100).optional(),
}).strict()

export const semanticSearchQuerySchema = z.object({
  workspace: pathSchema,
  query: z.string().trim().min(1).max(10_000),
  limit: z.number().int().min(1).max(100).optional(),
  filters: semanticSearchFiltersSchema.optional(),
  embeddingSpace: semanticEmbeddingSpaceSchema.optional(),
}).strict()

export const semanticEmbeddingBindingSchema = z.object({
  reference: modelReferenceSchema,
  remoteAllowed: z.boolean(),
}).strict()

export const semanticContractMetadata = {
  indexVersion: SEMANTIC_INDEX_VERSION,
  chunkStrategyVersion: SEMANTIC_CHUNK_STRATEGY_VERSION,
} as const
