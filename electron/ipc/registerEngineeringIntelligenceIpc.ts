import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { EngineeringHealthReport } from '../../shared/engineeringIntelligence'
import { projectIndexWorkspaceSchema } from '../../shared/ipc/schemas'
import type { LocalDatabase } from '../database/Database'
import type { EngineeringSignalEngine } from '../engineering/EngineeringSignalEngine'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  assertAuthorized(value: string): string
}

export function registerEngineeringIntelligenceIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  engine: EngineeringSignalEngine,
  dependencies: Dependencies,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const workspace = (value: unknown) => dependencies.assertAuthorized(projectIndexWorkspaceSchema.parse(value).workspace)
  const report = async (value: unknown): Promise<EngineeringHealthReport> => {
    const authorizedWorkspace = workspace(value)
    const evaluation = await engine.evaluate(authorizedWorkspace)
    return {
      snapshot: evaluation.snapshot,
      signals: database.engineeringIntelligence.listSignals(authorizedWorkspace, 'active'),
      insights: database.engineeringIntelligence.listInsights(authorizedWorkspace, 'active'),
      trends: evaluation.trends,
    }
  }

  ipcMain.handle(IPC_CHANNELS.engineeringIntelligence.report, (_event, value: unknown) => report(value))
  const dispose = () => { if (ownsRegistrar) ipcMain.dispose() }
  return dispose
}
