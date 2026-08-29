import { clipboard, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

export function registerClipboardIpc(win: BrowserWindow, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  ipcMain.handle(IPC_CHANNELS.clipboard.readText, () => clipboard.readText().slice(0, 10_000))
  ipcMain.handle(IPC_CHANNELS.clipboard.writeText, (_event, value: unknown) => {
    clipboard.writeText(z.string().max(100_000).parse(value))
  })
  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
