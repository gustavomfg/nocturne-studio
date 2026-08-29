import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { LocalDatabase } from '../database/Database'
import type { Logger } from '../logging/Logger'
import { backupSchema } from '../../shared/ipc/backupSchemas'
import { assertBackupByteLimit, assertBackupMetrics, assertBackupRecordLimit, countBackupRecords } from '../../shared/ipc/backupLimits'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import { parseBackupInWorker, serializeBackupInWorker } from './backupWorkers'
import { assertSafeWorkspaceScope } from '../security/WorkspaceTrust'
import { IPC_CHANNELS } from '../../shared/ipc/channels'

export function registerDataIpc(win: BrowserWindow, database: LocalDatabase, logger: Logger, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  ipcMain.handle(IPC_CHANNELS.data.export, async () => {
    const warning = await dialog.showMessageBox(win, { type: 'info', buttons: ['Continuar', 'Cancelar'], defaultId: 0, cancelId: 1, title: 'Exportar dados do Nocturne', message: 'O backup inclui todas as conversas, memórias e artefatos do workspace.', detail: 'Credenciais de API não são exportadas. Mantenha o arquivo em local seguro — ele contém o histórico completo de conversas e dados do projeto.' })
    if (warning.response !== 0) return null
    const result = await dialog.showSaveDialog(win, { title: 'Exportar dados do Nocturne', defaultPath: 'nocturne-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    const startedAt = performance.now()
    const metrics = database.getExportMetrics()
    assertBackupMetrics(metrics.records, metrics.estimatedBytes)
    const exported = backupSchema.parse(database.exportData())
    assertBackupRecordLimit(exported)
    const serialized = await serializeBackupInWorker(exported)
    assertBackupByteLimit(Buffer.byteLength(serialized, 'utf8'))
    await atomicWriteBackup(result.filePath, serialized)
    logger.info('persistence', 'Dados exportados', { bytes: Buffer.byteLength(serialized), durationMs: Math.round(performance.now() - startedAt) })
    return result.filePath
  })
  ipcMain.handle(IPC_CHANNELS.data.import, async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Importar dados do Nocturne', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return false
    const importPath = result.filePaths[0]
    const stat = await fs.promises.stat(importPath)
    assertBackupByteLimit(stat.size)
    const parsed = await parseBackupInWorker(importPath)
    const validated = backupSchema.parse(parsed)
    for (const workspace of validated.workspaces) assertSafeWorkspaceScope(workspace.path, false)
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Restaurar tudo', 'Somente projetos e histórico'],
      defaultId: 0,
      cancelId: 0,
      title: 'Restaurar backup',
      message: 'Como deseja restaurar este backup?',
      detail: '“Restaurar tudo” substitui também Providers, modelos e preferências. A opção parcial substitui workspaces, conversas, artefatos, sugestões e memórias, preservando a configuração de IA e do aplicativo. Um ponto de recuperação local será criado antes.',
    })
    if (confirmation.response !== 1 && confirmation.response !== 2) return false
    const scope = confirmation.response === 2 ? 'project-data' : 'full'
    const startedAt = performance.now()
    const recoveryPath = await database.createRecoverySnapshot()
    database.importData({ ...validated, settings: validated.settings }, scope)
    logger.info('persistence', 'Dados importados', { recoveryPath, scope, records: countBackupRecords(validated), durationMs: Math.round(performance.now() - startedAt) })
    return true
  })
  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

async function atomicWriteBackup(destination: string, content: string) {
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.rename(temporary, destination)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.promises.unlink(temporary).catch(() => undefined)
    throw error
  }
}
