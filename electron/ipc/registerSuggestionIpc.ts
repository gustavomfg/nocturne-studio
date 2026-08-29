import type { BrowserWindow } from 'electron'
import { extractSuggestions, reviewComparisonMarkdown } from '../../shared/suggestions'
import type { LocalDatabase } from '../database/Database'
import type { Logger } from '../logging/Logger'
import { conversationPageSchema, idSchema, suggestionExtractSchema, suggestionStatusSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  authorizedWorkspace(conversationId: string): string
  recordDecision(workspace: string, suggestion: { title: string; status: string; updatedAt: string }): Promise<void>
}

/** Registers structured review suggestion reads, reconciliation and decisions. */
export function registerSuggestionIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  logger: Logger,
  dependencies: Dependencies,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.suggestions.list, (_event, value: unknown) => {
    return database.listSuggestions(idSchema.parse(value))
  })
  ipcMain.handle(IPC_CHANNELS.suggestions.page, (_event, value: unknown) => {
    const data = conversationPageSchema.parse(value)
    return database.listSuggestionPage(data.conversationId, data.offset, data.limit)
  })
  ipcMain.handle(IPC_CHANNELS.suggestions.create, (_event, value: unknown) => {
    const data = suggestionExtractSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    const extracted = extractSuggestions(data.content)
    if (!extracted.structured) {
      return {
        suggestions: [],
        content: extracted.content,
        warning: 'A resposta não trouxe um snapshot estruturado; sugestões anteriores foram preservadas.',
      }
    }
    const reconciliation = database.reconcileSuggestions(
      data.conversationId,
      workspace,
      extracted.suggestions,
    )
    if (reconciliation.suggestions.length || reconciliation.comparison.resolvedSuggestions.length) {
      logger.info('artifacts', 'Sugestões de review reconciliadas', {
        conversationId: data.conversationId,
        count: reconciliation.suggestions.length,
        resolved: reconciliation.comparison.resolvedSuggestions.length,
      })
    }
    return {
      ...reconciliation,
      content: [extracted.content, reviewComparisonMarkdown(reconciliation.comparison)]
        .filter(Boolean)
        .join('\n\n'),
    }
  })
  ipcMain.handle(IPC_CHANNELS.suggestions.status, async (_event, value: unknown) => {
    const data = suggestionStatusSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    const suggestion = database.getSuggestion(data.suggestionId, data.conversationId)
    if (!suggestion) throw new Error('Sugestão não pertence a esta conversa.')
    const updated = database.setSuggestionStatus(data.suggestionId, data.status, data.result)
    try {
      await dependencies.recordDecision(workspace, updated)
    } catch (error) {
      logger.warn('persistence', 'A decisão foi salva no banco, mas o histórico em .nocturne não pôde ser atualizado.', {
        suggestionId: updated.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return updated
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
