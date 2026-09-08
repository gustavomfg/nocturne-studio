import { z } from 'zod'
import { modelCapabilitySchema } from './modelSchemas'
import {
  AI_TASK_LIMITS,
  contextSourceTypes,
  executionModes,
  taskOutputFormats,
} from './task'

const identifierSchema = z.string().trim().min(1).max(512)
const normalizedMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(AI_TASK_LIMITS.messageCharacters),
}).strict()

const contextSourceSchema = z.object({
  id: identifierSchema,
  type: z.enum(contextSourceTypes),
  title: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(AI_TASK_LIMITS.contextSourceCharacters),
  scope: z.string().trim().min(1).max(512),
  relevance: z.number().min(0).max(1).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  potentiallyOutdated: z.boolean(),
  stale: z.boolean().optional(),
  provenance: z.object({
    sourcePath: z.string().max(4_000).optional(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    chunkHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    indexVersion: z.number().int().positive().optional(),
    chunkStrategyVersion: z.string().max(100).optional(),
    embeddingProviderId: z.string().max(512).optional(),
    embeddingModelId: z.string().max(512).optional(),
    retrievalReason: z.string().max(2_000).optional(),
  }).strict().optional(),
}).strict()

const modelSelectionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('explicit'),
    model: z.object({
      providerId: identifierSchema,
      modelId: identifierSchema,
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('workspace-default'),
  }).strict(),
])

const taskBodySchema = z.object({
  workspace: z.object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(500),
  }).strict(),
  intent: z.string().trim().min(1).max(AI_TASK_LIMITS.intentCharacters),
  mode: z.enum(executionModes),
  messages: z.array(normalizedMessageSchema).max(AI_TASK_LIMITS.messages),
  context: z.array(contextSourceSchema).max(AI_TASK_LIMITS.contextSources),
  constraints: z.array(
    z.string().trim().min(1).max(AI_TASK_LIMITS.constraintCharacters),
  ).max(AI_TASK_LIMITS.constraints),
  requirements: z.array(modelCapabilitySchema),
  selection: modelSelectionSchema,
  output: z.object({
    format: z.enum(taskOutputFormats),
  }).strict(),
  permissions: z.object({
    workspaceAccess: z.enum(['read-only', 'workspace-write']),
  }).strict(),
  tools: z.tuple([]),
}).strict().superRefine((task, context) => {
  if (task.mode === 'review' && task.permissions.workspaceAccess !== 'read-only') {
    context.addIssue({
      code: 'custom',
      path: ['permissions', 'workspaceAccess'],
      message: 'Review Mode exige acesso somente leitura.',
    })
  }
  if (new Set(task.requirements).size !== task.requirements.length) {
    context.addIssue({
      code: 'custom',
      path: ['requirements'],
      message: 'Capacidades duplicadas não são permitidas.',
    })
  }
  const sourceIds = new Set<string>()
  let contextCharacters = 0
  for (const [index, source] of task.context.entries()) {
    contextCharacters += source.content.length
    if (sourceIds.has(source.id)) {
      context.addIssue({
        code: 'custom',
        path: ['context', index, 'id'],
        message: 'Fontes de contexto duplicadas não são permitidas.',
      })
    }
    sourceIds.add(source.id)
    if (source.type === 'memory' && !source.potentiallyOutdated) {
      context.addIssue({
        code: 'custom',
        path: ['context', index, 'potentiallyOutdated'],
        message: 'Memórias devem permanecer marcadas como potencialmente desatualizadas.',
      })
    }
  }
  if (contextCharacters > AI_TASK_LIMITS.totalContextCharacters) {
    context.addIssue({
      code: 'custom',
      path: ['context'],
      message: 'O contexto total excede o limite permitido.',
    })
  }
})

export const normalizedTaskInputSchema = taskBodySchema
export const normalizedTaskSchema = taskBodySchema.safeExtend({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
})
