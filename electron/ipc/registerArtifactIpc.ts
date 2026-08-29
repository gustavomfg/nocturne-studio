import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { LocalDatabase } from '../database/Database'
import { conversationPageSchema, idSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  authorizedWorkspace(conversationId: string): string
}

/** Registers artifact listing, pagination and deletion. */
export function registerArtifactIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  dependencies: Dependencies,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.artifacts.list, (_event, value: unknown) => {
    return database.listArtifacts(idSchema.parse(value))
  })
  ipcMain.handle(IPC_CHANNELS.artifacts.page, (_event, value: unknown) => {
    const data = conversationPageSchema.parse(value)
    return database.listArtifactPage(data.conversationId, data.offset, data.limit)
  })
  ipcMain.handle(IPC_CHANNELS.artifacts.delete, (_event, value: unknown) => {
    const data = z.object({
      conversationId: idSchema,
      artifactId: idSchema,
    }).strict().parse(value)
    dependencies.authorizedWorkspace(data.conversationId)
    if (!database.deleteArtifact(data.artifactId, data.conversationId)) {
      throw new Error('Artefato não encontrado ou já removido.')
    }
    return { deleted: true as const }
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
