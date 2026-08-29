import { z } from 'zod'
import { agentModes, suggestionStatuses } from '../suggestions'
import { PERSISTENCE_LIMITS } from '../constants'
import { brainMemoryKinds, brainMemoryScopes, brainMemoryStatuses, isSafeBrainMemoryContent } from '../brainMemory'
import { PROVIDER_CONFIGURATION_LIMITS } from '../ai/providerConfiguration'
import { providerConfigurationInputSchema } from '../ai/providerConfigurationSchemas'
import { MODEL_LIMITS } from '../ai/model'
import { isJsonValueWithinLimit, type JsonValue } from '../json'

export const idSchema = z.string().uuid()
export const pageSchema = z.object({ offset: z.number().int().min(0).max(1_000_000), limit: z.number().int().min(1).max(200) }).strict()
export const conversationPageSchema = pageSchema.extend({ conversationId: idSchema })
export const aiSendSchema = z.object({ conversationId: idSchema, prompt: z.string().trim().min(1).max(100_000), attachments: z.array(z.string().trim().min(1).max(4_000)).max(10).default([]), mode: z.enum(agentModes).default('build') }).strict()
export const aiCancelSchema = z.object({ conversationId: idSchema }).strict()
export const approvalSchema = z.object({ key: z.string().min(1), accepted: z.boolean(), forSession: z.boolean().optional() })
export const workspaceFavoriteSchema = z.object({ workspace: z.string().min(1), favorite: z.boolean() })
export const workspaceToolSchema = z.object({ workspace: z.string().min(1), tool: z.enum(['editor', 'terminal']) })
export const fileActionSchema = z.object({ conversationId: idSchema, filePath: z.string().min(1), action: z.enum(['file', 'folder', 'editor']) })
export const filePreviewSchema = z.object({ conversationId: idSchema, filePath: z.string().min(1) })
export const rendererStatsSchema = z.object({
  responseSize: z.number().int().nonnegative().max(10_000_000),
  activities: z.number().int().nonnegative().max(100_000),
  messages: z.number().int().nonnegative().max(100_000),
  renderCounts: z.object({
    app: z.number().int().nonnegative().max(1_000_000),
    chat: z.number().int().nonnegative().max(1_000_000),
    composer: z.number().int().nonnegative().max(1_000_000),
    agentPanel: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
  startupMs: z.number().nonnegative().max(600_000),
  conversationLoadMs: z.number().nonnegative().max(600_000),
  longTasks: z.number().int().nonnegative().max(100_000),
  longTaskDurationMs: z.number().nonnegative().max(10_000_000),
  longestLongTaskMs: z.number().nonnegative().max(600_000),
}).strict()
export const suggestionStatusSchema = z.object({ conversationId: idSchema, suggestionId: idSchema, status: z.enum(suggestionStatuses), result: z.string().max(20_000).optional() })
export const suggestionExtractSchema = z.object({ conversationId: idSchema, content: z.string().max(PERSISTENCE_LIMITS.assistantCharacters) }).strict()
export const gitCommitSchema = z.object({ conversationId: idSchema, message: z.string().trim().min(1).max(200), files: z.array(z.string().min(1).max(4_000)).min(1).max(1_000) })
const assistantMetadataSchema = z.custom<JsonValue>((value) => isJsonValueWithinLimit(value, PERSISTENCE_LIMITS.metadataCharacters), 'O metadata precisa conter apenas valores JSON válidos dentro do limite permitido.')
export const saveAssistantSchema = z.object({ conversationId: idSchema, content: z.string().max(PERSISTENCE_LIMITS.assistantCharacters), metadata: assistantMetadataSchema.optional() })
export const prepareMarkdownSchema = z.object({ conversationId: idSchema, content: z.string().min(1).max(PERSISTENCE_LIMITS.documentCharacters), name: z.string().trim().min(1).max(PERSISTENCE_LIMITS.documentNameCharacters).default('documento.md') }).strict()
export const applyMarkdownSchema = z.object({ conversationId: idSchema, target: z.string().min(1).max(4_000), generated: z.string().min(1).max(PERSISTENCE_LIMITS.documentCharacters), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), strategy: z.enum(['append', 'replace']) }).strict()
export const exportDocumentSchema = z.object({ conversationId: idSchema, content: z.string().max(PERSISTENCE_LIMITS.documentCharacters), format: z.enum(['docx', 'pdf', 'html']) })
export const brainMemoryPageSchema = conversationPageSchema.extend({ query: z.string().trim().max(500).default(''), status: z.enum(brainMemoryStatuses).optional() })
const safeBrainMemoryContent = z.string().trim().min(1).max(8_000).refine(isSafeBrainMemoryContent, 'A memória parece conter uma credencial e não pode ser persistida.')
export const brainMemoryCreateSchema = z.object({ conversationId: idSchema, kind: z.enum(brainMemoryKinds), scope: z.enum(brainMemoryScopes), content: safeBrainMemoryContent }).strict()
export const brainMemoryUpdateSchema = z.object({
  conversationId: idSchema, memoryId: idSchema, kind: z.enum(brainMemoryKinds).optional(), scope: z.enum(brainMemoryScopes).optional(), content: safeBrainMemoryContent.optional(), confidence: z.number().int().min(0).max(100).optional(), status: z.enum(brainMemoryStatuses).optional(),
}).strict().refine((value) => value.kind !== undefined || value.scope !== undefined || value.content !== undefined || value.confidence !== undefined || value.status !== undefined, 'Informe ao menos uma alteração.')
export const brainMemoryDeleteSchema = z.object({ conversationId: idSchema, memoryId: idSchema }).strict()
export const brainMemoryExtractSchema = z.object({ conversationId: idSchema, content: z.string().max(PERSISTENCE_LIMITS.assistantCharacters) }).strict()
const providerCredentialSchema = z.string().min(1).max(PROVIDER_CONFIGURATION_LIMITS.credentialCharacters)
export const providerConfigurationCreateSchema = z.object({
  configuration: providerConfigurationInputSchema,
  credential: providerCredentialSchema.optional(),
}).strict()
export const providerConfigurationUpdateSchema = z.object({
  id: idSchema,
  configuration: providerConfigurationInputSchema,
  credential: providerCredentialSchema.optional(),
  clearCredential: z.boolean().optional(),
}).strict().refine(
  (value) => value.credential === undefined || !value.clearCredential,
  'A credencial não pode ser definida e removida na mesma operação.',
)
export const providerConfigurationIdSchema = z.object({ id: idSchema }).strict()
export const modelProviderIdSchema = z.object({
  providerId: z.string().trim().min(1).max(MODEL_LIMITS.identifierCharacters),
}).strict()
