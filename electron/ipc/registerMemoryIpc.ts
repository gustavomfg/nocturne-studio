import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { LocalDatabase } from '../database/Database'
import type { Logger } from '../logging/Logger'
import { extractBrainMemoryCandidates } from '../../shared/suggestions'
import { isSafeBrainMemoryContent } from '../../shared/brainMemory'
import { brainMemoryCreateSchema, brainMemoryDeleteSchema, brainMemoryExtractSchema, brainMemoryPageSchema, brainMemoryUpdateSchema, idSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface WorkspaceContext {
  content: string
  rules: string
  updatedAt: string
}

interface Dependencies {
  authorizedWorkspace(conversationId: string): string
  read(workspace: string): Promise<WorkspaceContext>
  write(workspace: string, content: string, rules: string): Promise<WorkspaceContext>
}

/** Registers plain workspace context and structured memory operations. */
export function registerMemoryIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  logger: Logger,
  dependencies: Dependencies,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.memory.get, async (_event, value: unknown) => {
    const workspace = dependencies.authorizedWorkspace(idSchema.parse(value))
    const files = await dependencies.read(workspace)
    const persisted = database.getWorkspaceMemory(workspace)
    if (!persisted.content || Date.parse(persisted.updatedAt) <= Date.parse(files.updatedAt)) return files
    const marker = '\n\n# Regras do projeto\n'
    const markerAt = persisted.content.indexOf(marker)
    return dependencies.write(
      workspace,
      markerAt >= 0 ? persisted.content.slice(0, markerAt) : persisted.content,
      markerAt >= 0 ? persisted.content.slice(markerAt + marker.length) : files.rules,
    )
  })

  ipcMain.handle(IPC_CHANNELS.memory.set, async (_event, value: unknown) => {
    const data = z.object({
      conversationId: idSchema,
      content: z.string().max(20_000),
      rules: z.string().max(20_000).default(''),
    }).parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    if (!isSafeBrainMemoryContent(data.content) || !isSafeBrainMemoryContent(data.rules)) {
      throw new Error('A memória parece conter uma credencial e não pode ser persistida.')
    }
    const result = await dependencies.write(workspace, data.content, data.rules)
    database.setWorkspaceMemory(workspace, `${data.content}\n\n# Regras do projeto\n${data.rules}`)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.brain.page, (_event, value: unknown) => {
    const data = brainMemoryPageSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    return database.listBrainMemoryPage(workspace, data.offset, data.limit, data.query, data.status)
  })

  ipcMain.handle(IPC_CHANNELS.brain.history, (_event, value: unknown) => {
    const data = brainMemoryDeleteSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    return database.listBrainMemoryHistory(data.memoryId, workspace)
  })

  ipcMain.handle(IPC_CHANNELS.brain.create, (_event, value: unknown) => {
    const data = brainMemoryCreateSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    const memory = database.createBrainMemory(workspace, {
      kind: data.kind,
      scope: data.scope,
      content: data.content,
      conversationId: data.scope === 'conversation' ? data.conversationId : undefined,
      sourceType: 'manual',
      status: 'candidate',
    })
    logger.info('persistence', 'Candidata de memória criada', {
      memoryId: memory.id,
      conversationId: data.conversationId,
      scope: memory.scope,
      kind: memory.kind,
    })
    return memory
  })

  ipcMain.handle(IPC_CHANNELS.brain.update, (_event, value: unknown) => {
    const data = brainMemoryUpdateSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    const memory = database.updateBrainMemory(data.memoryId, workspace, {
      kind: data.kind,
      scope: data.scope,
      content: data.content,
      confidence: data.confidence,
      status: data.status,
      conversationId: data.scope === 'conversation'
        ? data.conversationId
        : data.scope === 'workspace' ? null : undefined,
    })
    logger.info('persistence', 'Memória estruturada atualizada', {
      memoryId: memory.id,
      conversationId: data.conversationId,
      status: memory.status,
    })
    return memory
  })

  ipcMain.handle(IPC_CHANNELS.brain.delete, (_event, value: unknown) => {
    const data = brainMemoryDeleteSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    if (!database.deleteBrainMemory(data.memoryId, workspace)) {
      throw new Error('Memória não encontrada ou já removida.')
    }
    logger.info('persistence', 'Memória estruturada removida', {
      memoryId: data.memoryId,
      conversationId: data.conversationId,
    })
    return { deleted: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.brain.extract, (_event, value: unknown) => {
    const data = brainMemoryExtractSchema.parse(value)
    const workspace = dependencies.authorizedWorkspace(data.conversationId)
    const extracted = extractBrainMemoryCandidates(data.content)
    try {
      const memories = database.createBrainMemoryCandidates(
        workspace,
        data.conversationId,
        extracted.candidates,
      )
      if (memories.length) {
        logger.info('persistence', 'Candidatas de memória extraídas', {
          conversationId: data.conversationId,
          count: memories.length,
        })
      }
      return { memories, content: extracted.content }
    } catch (error) {
      logger.error('persistence', 'Falha ao persistir candidatas de memória', {
        conversationId: data.conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        memories: [],
        content: extracted.content,
        warning: 'A resposta foi preservada, mas não foi possível salvar as candidatas do Segundo Cérebro.',
      }
    }
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
