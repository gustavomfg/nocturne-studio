import type { BrowserWindow } from 'electron'
import { validationListSchema, validationRunSchema, projectIndexWorkspaceSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { ValidationPipeline } from '../validation/ValidationPipeline'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  assertAuthorized(value: string): string
}

export function registerValidationIpc(win: BrowserWindow, pipeline: ValidationPipeline, dependencies: Dependencies, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const workspace = (value: unknown) => dependencies.assertAuthorized(projectIndexWorkspaceSchema.parse(value).workspace)

  ipcMain.handle(IPC_CHANNELS.validation.run, (_event, value: unknown) => {
    const data = validationRunSchema.parse(value)
    return pipeline.run(dependencies.assertAuthorized(data.workspace), data.kind)
  })
  ipcMain.handle(IPC_CHANNELS.validation.cancel, (_event, value: unknown) => pipeline.cancel(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.validation.latest, (_event, value: unknown) => pipeline.latest(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.validation.list, (_event, value: unknown) => {
    const data = validationListSchema.parse(value)
    return pipeline.list(dependencies.assertAuthorized(data.workspace), data.limit)
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
