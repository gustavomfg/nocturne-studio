import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { updateCommandArgsSchema } from '../../shared/ipc/schemas'
import type { UpdateService } from '../updates/UpdateService'
import type { SafeIpcMain } from './safeIpc'

export function registerUpdateIpc(win: BrowserWindow, service: UpdateService | undefined, ipcMain: SafeIpcMain) {
  if (!service) return () => undefined

  const unsubscribe = service.subscribe((state) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC_CHANNELS.updates.changed, state)
  })
  const register = (channel: Parameters<SafeIpcMain['handle']>[0], operation: () => Promise<unknown>) => {
    ipcMain.handle(channel, (_event, ...args) => {
      updateCommandArgsSchema.parse(args)
      return operation()
    })
  }

  register(IPC_CHANNELS.updates.getState, async () => service.getCurrentState())
  register(IPC_CHANNELS.updates.check, () => service.checkForUpdates('manual'))
  register(IPC_CHANNELS.updates.download, () => service.downloadUpdate())
  register(IPC_CHANNELS.updates.retry, () => service.retryDownload())
  register(IPC_CHANNELS.updates.install, () => service.installUpdate())

  return unsubscribe
}
