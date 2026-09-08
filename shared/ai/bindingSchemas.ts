import { z } from 'zod'
import { modelReferenceSchema } from './modelSchemas'

export const workspaceModelBindingsSchema = z.object({
  workspaceId: z.string().trim().min(1).max(512),
  defaultBinding: modelReferenceSchema.optional(),
  embeddingBinding: modelReferenceSchema.optional(),
  remoteEmbeddingAllowed: z.boolean().optional(),
}).strict()
