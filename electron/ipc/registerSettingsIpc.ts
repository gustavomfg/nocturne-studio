import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { LocalDatabase } from '../database/Database'
import type { Logger } from '../logging/Logger'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

const settingsSchema = z.object({
  model: z.string().max(100).optional(),
  sandbox: z.enum(['read-only', 'workspace-write']).optional(),
  approvalPolicy: z.enum(['untrusted', 'on-request']).optional(),
  diagnosticMode: z.boolean().optional(),
  theme: z.enum(['dark', 'light']).optional(),
  language: z.enum(['pt-BR', 'en']).optional(),
}).strict()

export function registerSettingsIpc(win: BrowserWindow, database: LocalDatabase, logger: Logger, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const readSettings = () => {
    const saved = database.getSettings()
    return { ...saved, diagnosticMode: saved.diagnosticMode === 'true' }
  }

  ipcMain.handle(IPC_CHANNELS.settings.get, () => readSettings())
  ipcMain.handle(IPC_CHANNELS.settings.set, (_event, value: unknown) => {
    const data = settingsSchema.parse(value)
    if (data.diagnosticMode !== undefined) logger.setDiagnostic(data.diagnosticMode)
    const { diagnosticMode, ...rest } = data
    const updates: Record<string, string> = { ...rest }
    if (diagnosticMode !== undefined) updates.diagnosticMode = String(diagnosticMode)
    database.setSettings(updates)
    return readSettings()
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
