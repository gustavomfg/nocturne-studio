import { z } from 'zod'
import type { BrowserWindow } from 'electron'
import type { LocalDatabase } from '../database/Database'
import { idSchema, pageSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import { getAuthorizedConversation } from './conversationAccess'

interface Dependencies {
  ensureWorkspace(workspace: string): Promise<void>
  assertKnownWorkspace(value: string): string
}

/** Registers conversation reads, pagination, creation and deletion. */
export function registerConversationIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  dependencies: Dependencies,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.conversations.list, () => database.listConversations())
  ipcMain.handle(IPC_CHANNELS.conversations.page, (_event, value: unknown) => {
    const data = pageSchema.parse(value)
    return database.listConversationPage(data.offset, data.limit)
  })
  ipcMain.handle(IPC_CHANNELS.conversations.create, async (_event, value: unknown) => {
    const workspace = dependencies.assertKnownWorkspace(z.string().min(1).parse(value))
    await dependencies.ensureWorkspace(workspace)
    return database.createConversation(workspace)
  })
  ipcMain.handle(IPC_CHANNELS.conversations.messages, (_event, value: unknown) => {
    return database.listMessages(idSchema.parse(value))
  })
  ipcMain.handle(IPC_CHANNELS.conversations.messagePage, (_event, value: unknown) => {
    const data = z.object({
      id: idSchema,
      offset: z.number().int().min(0).max(1_000_000),
      limit: z.number().int().min(1).max(200),
    }).strict().parse(value)
    return database.listMessagePage(data.id, data.offset, data.limit)
  })
  ipcMain.handle(IPC_CHANNELS.conversations.delete, (_event, value: unknown) => {
    const conversation = getAuthorizedConversation(database, idSchema.parse(value))
    database.deleteConversation(conversation.id)
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
