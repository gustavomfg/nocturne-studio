import { z } from 'zod'
import { suggestionStatuses } from '../suggestions'
import { BACKUP_LIMITS } from './backupLimits'
import { DATABASE_SCHEMA_VERSION, PERSISTENCE_LIMITS } from '../constants'
import { brainMemoryHistoryActions, isSafeBrainMemoryContent } from '../brainMemory'
import { modelDescriptorSchema } from '../ai/modelSchemas'
import { workspaceModelBindingsSchema } from '../ai/bindingSchemas'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const pathValue = z.string().min(1).max(4_000)
const jsonText = (limit: number) => z.string().max(limit).refine((value) => { try { JSON.parse(value); return true } catch { return false } }, 'JSON inválido')

const workspace = z.object({ path: pathValue, name: z.string().min(1).max(500), favorite: z.union([z.literal(0), z.literal(1)]).default(0), authorized: z.union([z.literal(0), z.literal(1)]).optional(), created_at: timestamp, last_opened_at: timestamp }).strict()
const conversation = z.object({ id: uuid, title: z.string().min(1).max(500), workspace: pathValue, codex_thread_id: z.string().min(1).max(512).nullable().default(null), created_at: timestamp, updated_at: timestamp }).strict()
const message = z.object({ id: uuid, conversation_id: uuid, role: z.enum(['user', 'assistant', 'system']), content: z.string().max(2_000_000), metadata: jsonText(PERSISTENCE_LIMITS.metadataCharacters).nullable().default(null), created_at: timestamp }).strict()
const artifact = z.object({ id: uuid, conversation_id: uuid, workspace: pathValue, type: z.string().min(1).max(50), title: z.string().min(1).max(500), file_path: pathValue.nullable().default(null), content: z.string().max(2_000_000).nullable().default(null), metadata: jsonText(PERSISTENCE_LIMITS.metadataCharacters).nullable().default(null), created_at: timestamp, updated_at: timestamp }).strict()
const memory = z.object({ workspace: pathValue, content: z.string().max(50_000), updated_at: timestamp }).strict()
const brainMemory = z.object({ id: uuid, workspace_id: pathValue, conversation_id: uuid.nullable().default(null), kind: z.enum(['fact', 'decision', 'preference', 'constraint', 'learning']), scope: z.enum(['workspace', 'conversation']), status: z.enum(['candidate', 'active', 'outdated', 'archived']), content: z.string().trim().min(1).max(8_000).refine(isSafeBrainMemoryContent, 'A memória parece conter uma credencial.'), confidence: z.number().int().min(0).max(100), source_type: z.enum(['manual', 'message', 'agent']), source_id: z.string().max(500).nullable().default(null), created_at: timestamp, updated_at: timestamp, last_confirmed_at: timestamp.nullable().default(null), last_used_at: timestamp.nullable().default(null), use_count: z.number().int().min(0).default(0) }).strict()
const brainMemoryHistoryEntry = z.object({ id: z.string().min(1).max(500), memory_id: uuid, action: z.enum(brainMemoryHistoryActions), from_status: z.enum(['candidate', 'active', 'outdated', 'archived']).nullable(), to_status: z.enum(['candidate', 'active', 'outdated', 'archived']), summary: z.string().min(1).max(500), created_at: timestamp }).strict()
const persistedSuggestionStatus = z.enum([...suggestionStatuses, 'pending', 'applied']).transform((status) =>
  status === 'pending' ? 'new' as const : status === 'applied' ? 'resolved' as const : status,
)
const suggestion = z.object({ id: uuid, workspace_id: pathValue, conversation_id: uuid, title: z.string().min(1).max(200), description: z.string().max(4_000), reasoning: z.string().max(8_000), category: z.string().min(1).max(50), severity: z.enum(['info', 'low', 'medium', 'high', 'critical']), affected_files: jsonText(100_000), proposed_changes: z.string().max(200_000), expected_benefits: jsonText(100_000).default('[]'), complexity: z.enum(['low', 'medium', 'high']).default('medium'), risk: z.enum(['low', 'medium', 'high']).default('medium'), evidence: jsonText(250_000).default('[]'), confidence: z.number().int().min(0).max(100).default(60), source: z.string().min(1).max(500).default('Análise do agente'), responsible: z.string().min(1).max(500).default('Agente de revisão'), status: persistedSuggestionStatus, result: z.string().max(20_000).nullable().default(null), created_at: timestamp, updated_at: timestamp }).strict()
const decision = z.object({ id: uuid, suggestion_id: uuid, status: persistedSuggestionStatus, result: z.string().max(20_000).nullable().default(null), created_at: timestamp }).strict()
const providerConfig = z.object({ id: uuid, provider_type: z.literal('openai-compatible'), display_name: z.string().trim().min(1).max(500), source: z.enum(['local', 'remote']), base_url: z.string().trim().min(1).max(2_048), enabled: z.union([z.literal(0), z.literal(1)]), requires_authentication: z.union([z.literal(0), z.literal(1)]), timeout_ms: z.number().int().min(1_000).max(120_000), created_at: timestamp, updated_at: timestamp }).strict()
const modelCatalogItem = z.object({ provider_id: z.string().trim().min(1).max(512), model_id: z.string().trim().min(1).max(512), descriptor: jsonText(100_000), updated_at: timestamp }).strict().superRefine((item, context) => {
  try {
    const descriptor = modelDescriptorSchema.parse(JSON.parse(item.descriptor))
    if (descriptor.providerId !== item.provider_id || descriptor.modelId !== item.model_id) throw new Error()
  } catch {
    context.addIssue({ code: 'custom', path: ['descriptor'], message: 'Descriptor de modelo inconsistente.' })
  }
})
const workspaceModelBinding = z.object({ workspace_id: pathValue, bindings: jsonText(50_000), updated_at: timestamp }).strict().superRefine((item, context) => {
  try {
    const bindings = workspaceModelBindingsSchema.parse(JSON.parse(item.bindings))
    if (bindings.workspaceId !== item.workspace_id) throw new Error()
  } catch {
    context.addIssue({ code: 'custom', path: ['bindings'], message: 'Bindings de modelos inconsistentes.' })
  }
})
const settings = z.object({ model: z.string().max(100).optional(), sandbox: z.enum(['read-only', 'workspace-write']).optional(), approvalPolicy: z.enum(['untrusted', 'on-request']).optional(), diagnosticMode: z.enum(['true', 'false']).optional(), theme: z.enum(['dark', 'light']).optional(), language: z.enum(['pt-BR', 'en']).optional() }).strict()

export const backupSchema = z.object({ schemaVersion: z.number().int().min(1).max(DATABASE_SCHEMA_VERSION), exportedAt: timestamp.optional(), conversations: z.array(conversation).max(25_000), workspaces: z.array(workspace).max(5_000), messages: z.array(message).max(100_000), artifacts: z.array(artifact).max(50_000), memories: z.array(memory).max(5_000), brainMemories: z.array(brainMemory).max(50_000).default([]), brainMemoryHistory: z.array(brainMemoryHistoryEntry).max(100_000).default([]), suggestions: z.array(suggestion).max(25_000).default([]), suggestionDecisions: z.array(decision).max(50_000).default([]), providerConfigs: z.array(providerConfig).max(1_000).default([]), modelCatalog: z.array(modelCatalogItem).max(25_000).default([]), workspaceModelBindings: z.array(workspaceModelBinding).max(5_000).default([]), settings: settings.optional() }).strict().superRefine((data, context) => {
  const totalRecords = data.conversations.length + data.workspaces.length + data.messages.length + data.artifacts.length + data.memories.length + data.brainMemories.length + data.brainMemoryHistory.length + data.suggestions.length + data.suggestionDecisions.length + data.providerConfigs.length + data.modelCatalog.length + data.workspaceModelBindings.length
  if (totalRecords > BACKUP_LIMITS.maxRecords) context.addIssue({ code: 'custom', message: `O backup excede o limite agregado de ${new Intl.NumberFormat('pt-BR').format(BACKUP_LIMITS.maxRecords)} registros.` })
  const conversations = new Set(data.conversations.map((item) => item.id))
  const workspaces = new Set(data.workspaces.map((item) => item.path))
  const suggestions = new Set(data.suggestions.map((item) => item.id))
  const uniqueCollections = [
    ['workspaces', data.workspaces.map((item) => item.path)],
    ['conversations', data.conversations.map((item) => item.id)],
    ['messages', data.messages.map((item) => item.id)],
    ['artifacts', data.artifacts.map((item) => item.id)],
    ['memories', data.memories.map((item) => item.workspace)],
    ['brainMemories', data.brainMemories.map((item) => item.id)],
    ['brainMemoryHistory', data.brainMemoryHistory.map((item) => item.id)],
    ['suggestions', data.suggestions.map((item) => item.id)],
    ['suggestionDecisions', data.suggestionDecisions.map((item) => item.id)],
    ['providerConfigs', data.providerConfigs.map((item) => item.id)],
    ['modelCatalog', data.modelCatalog.map((item) => JSON.stringify([item.provider_id, item.model_id]))],
    ['workspaceModelBindings', data.workspaceModelBindings.map((item) => item.workspace_id)],
  ] as const
  for (const [collection, values] of uniqueCollections) if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [collection], message: 'O backup contém identificadores duplicados.' })
  for (const [index, item] of data.conversations.entries()) if (!workspaces.has(item.workspace)) context.addIssue({ code: 'custom', path: ['conversations', index, 'workspace'], message: 'Workspace referenciado não existe no backup.' })
  for (const [index, item] of data.messages.entries()) if (!conversations.has(item.conversation_id)) context.addIssue({ code: 'custom', path: ['messages', index, 'conversation_id'], message: 'Conversa referenciada não existe no backup.' })
  for (const [index, item] of data.artifacts.entries()) { if (!conversations.has(item.conversation_id)) context.addIssue({ code: 'custom', path: ['artifacts', index, 'conversation_id'], message: 'Conversa referenciada não existe no backup.' }); if (!workspaces.has(item.workspace)) context.addIssue({ code: 'custom', path: ['artifacts', index, 'workspace'], message: 'Workspace referenciado não existe no backup.' }) }
  for (const [index, item] of data.memories.entries()) if (!workspaces.has(item.workspace)) context.addIssue({ code: 'custom', path: ['memories', index, 'workspace'], message: 'Workspace referenciado não existe no backup.' })
  for (const [index, item] of data.workspaceModelBindings.entries()) if (!workspaces.has(item.workspace_id)) context.addIssue({ code: 'custom', path: ['workspaceModelBindings', index, 'workspace_id'], message: 'Workspace dos bindings não existe no backup.' })
  for (const [index, item] of data.brainMemories.entries()) {
    if (!workspaces.has(item.workspace_id)) context.addIssue({ code: 'custom', path: ['brainMemories', index, 'workspace_id'], message: 'Workspace referenciado não existe no backup.' })
    if (item.scope === 'conversation' && (!item.conversation_id || !conversations.has(item.conversation_id))) context.addIssue({ code: 'custom', path: ['brainMemories', index, 'conversation_id'], message: 'Memória da conversa referencia uma conversa inexistente.' })
    if (item.scope === 'workspace' && item.conversation_id) context.addIssue({ code: 'custom', path: ['brainMemories', index, 'conversation_id'], message: 'Memória do workspace não pode referenciar uma conversa.' })
  }
  const brainMemories = new Set(data.brainMemories.map((item) => item.id))
  for (const [index, item] of data.brainMemoryHistory.entries()) if (!brainMemories.has(item.memory_id)) context.addIssue({ code: 'custom', path: ['brainMemoryHistory', index, 'memory_id'], message: 'Histórico referencia uma memória inexistente.' })
  for (const [index, item] of data.suggestions.entries()) { if (!conversations.has(item.conversation_id)) context.addIssue({ code: 'custom', path: ['suggestions', index, 'conversation_id'], message: 'Conversa referenciada não existe no backup.' }); if (!workspaces.has(item.workspace_id)) context.addIssue({ code: 'custom', path: ['suggestions', index, 'workspace_id'], message: 'Workspace referenciado não existe no backup.' }) }
  for (const [index, item] of data.suggestionDecisions.entries()) if (!suggestions.has(item.suggestion_id)) context.addIssue({ code: 'custom', path: ['suggestionDecisions', index, 'suggestion_id'], message: 'Sugestão referenciada não existe no backup.' })
})

export type BackupData = z.infer<typeof backupSchema>
