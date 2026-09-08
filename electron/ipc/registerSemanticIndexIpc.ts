import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { semanticIndexSearchSchema, projectIndexWorkspaceSchema } from '../../shared/ipc/schemas'
import type { SemanticIndexService } from '../semantic-index/SemanticIndexService'
import type { SemanticRetrievalService } from '../semantic-index/SemanticRetrievalService'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  assertAuthorized(value: string): string
}

export function registerSemanticIndexIpc(
  win: BrowserWindow,
  service: SemanticIndexService,
  retrieval: SemanticRetrievalService,
  dependencies: Dependencies,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const workspace = (value: unknown) => dependencies.assertAuthorized(projectIndexWorkspaceSchema.parse(value).workspace)

  ipcMain.handle(IPC_CHANNELS.semanticIndex.status, (_event, value: unknown) => service.getStatus(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.semanticIndex.start, (_event, value: unknown) => service.ensureIndexed(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.semanticIndex.cancel, (_event, value: unknown) => service.cancel(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.semanticIndex.summary, (_event, value: unknown) => service.getSummary(workspace(value)))
  ipcMain.handle(IPC_CHANNELS.semanticIndex.search, async (_event, value: unknown) => {
    const data = semanticIndexSearchSchema.parse(value)
    return retrieval.search({ ...data, workspace: dependencies.assertAuthorized(data.workspace) })
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
