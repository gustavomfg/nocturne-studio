import { dialog, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import packageMetadata from '../../package.json'
import { diagnosticFingerprint, type Logger } from '../logging/Logger'
import type { ProviderConfigurationOperations } from './registerProviderIpc'
import type { ModelRegistry } from '../ai/ModelRegistry'
import { rendererStatsSchema } from '../../shared/ipc/schemas'
import { RENDERER_PERFORMANCE_BUDGETS } from '../../shared/constants'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { writeAtomicFile } from '../persistence/AtomicFile'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import type { ProjectIndexMetricsSnapshot } from '../project-index/ProjectIndexService'
import type { ValidationMetricsSnapshot } from '../validation/ValidationPipeline'

export interface CodeIntelligenceMetrics {
  index: ProjectIndexMetricsSnapshot
  validation: ValidationMetricsSnapshot
}

export function registerDiagnosticsIpc(win: BrowserWindow, logger: Logger, providerConfigurations: ProviderConfigurationOperations, modelRegistry: ModelRegistry, registrar?: SafeIpcMain, codeIntelligenceMetrics?: () => CodeIntelligenceMetrics) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const diagnosticReport = () => ({
    app: 'Nocturne Studio',
    version: packageMetadata.version,
    platform: process.platform,
    arch: process.arch,
    runtime: { node: process.versions.node, electron: process.versions.electron ?? 'indisponível' },
    session: logger.snapshot(),
    providers: {
      configured: providerConfigurations.list().length,
      enabled: providerConfigurations.list().filter((provider) => provider.enabled).length,
    },
    models: modelRegistry.list().length,
    codeIntelligence: codeIntelligenceMetrics?.() ?? null,
  })

  ipcMain.handle(IPC_CHANNELS.diagnostics.openLogs, () => shell.openPath(logger.path))
  ipcMain.handle(IPC_CHANNELS.diagnostics.copy, async () => JSON.stringify(diagnosticReport(), null, 2))
  ipcMain.handle(IPC_CHANNELS.diagnostics.export, async () => {
    const result = await dialog.showSaveDialog(win, { title: 'Exportar diagnóstico sanitizado', defaultPath: `nocturne-diagnostic-${logger.snapshot().sessionId.slice(0, 8)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    await writeAtomicFile(result.filePath, `${JSON.stringify(diagnosticReport(), null, 2)}\n`)
    return result.filePath
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.rendererError, (_event, value: unknown) => {
    const data = z.object({ type: z.enum(['error', 'unhandledRejection']), message: z.string().max(8_000), stack: z.string().max(20_000).optional() }).parse(value)
    const fingerprint = diagnosticFingerprint(`${data.message}\n${data.stack ?? ''}`)
    logger.error('app', `Renderer ${data.type}`, { fingerprint })
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.rendererStats, (_event, value: unknown) => {
    const data = rendererStatsSchema.parse(value)
    logger.info('app', 'Métricas internas do renderer', {
      ...data,
      budgetExceeded: {
        startup: data.startupMs > RENDERER_PERFORMANCE_BUDGETS.startupMs,
        conversationLoad: data.conversationLoadMs > RENDERER_PERFORMANCE_BUDGETS.conversationLoadMs,
        longTask: data.longestLongTaskMs > RENDERER_PERFORMANCE_BUDGETS.longTaskMs,
      },
    })
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
