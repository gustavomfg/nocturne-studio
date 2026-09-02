import type { BrowserWindow } from 'electron'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import { projectIndexFileQuerySchema, projectIndexQuerySchema, projectIndexWorkspaceSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { ProjectIndexService } from '../project-index/ProjectIndexService'

interface Dependencies {
  assertAuthorized(value: string): string
}

export function registerProjectIndexIpc(win: BrowserWindow, service: ProjectIndexService, dependencies: Dependencies, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const workspace = (value: unknown) => dependencies.assertAuthorized(projectIndexWorkspaceSchema.parse(value).workspace)
  const query = (value: unknown) => {
    const data = projectIndexQuerySchema.parse(value)
    return { ...data, workspace: dependencies.assertAuthorized(data.workspace) }
  }
  const fileQuery = (value: unknown) => {
    const data = projectIndexFileQuerySchema.parse(value)
    return { ...data, workspace: dependencies.assertAuthorized(data.workspace) }
  }

  ipcMain.handle(IPC_CHANNELS.projectIndex.status, (_event, value: unknown) => service.getStatus(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.projectIndex.start, (_event, value: unknown) => service.startManual(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.projectIndex.cancel, (_event, value: unknown) => service.cancel(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.projectIndex.retry, (_event, value: unknown) => service.retryFailed(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.projectIndex.summary, (_event, value: unknown) => service.getSummary(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.projectIndex.files, (_event, value: unknown) => {
    const data = projectIndexWorkspaceSchema.extend({ limit: projectIndexQuerySchema.shape.limit }).parse(value)
    return service.listFiles(dependencies.assertAuthorized(data.workspace), data.limit)
  })
  ipcMain.handle(IPC_CHANNELS.projectIndex.symbols, (_event, value: unknown) => {
    const data = query(value)
    return service.listSymbols(data.workspace, data.query, data.limit)
  })
  ipcMain.handle(IPC_CHANNELS.projectIndex.imports, (_event, value: unknown) => {
    const data = fileQuery(value)
    return service.listImports(data.workspace, data.relativePath)
  })
  ipcMain.handle(IPC_CHANNELS.projectIndex.exports, (_event, value: unknown) => {
    const data = fileQuery(value)
    return service.listExports(data.workspace, data.relativePath)
  })
  ipcMain.handle(IPC_CHANNELS.projectIndex.stack, (_event, value: unknown) => service.listStackEvidence(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.projectIndex.exclusions, (_event, value: unknown) => service.listExclusions(workspace(value)))

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
