import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LocalDatabase } from './database/Database'
import { registerIpc } from './ipc/registerIpc'
import { diagnosticFingerprint, Logger, redactLogText } from './logging/Logger'
import { startUpdateService } from './updates/UpdateService'
import { ModelRegistry } from './ai/ModelRegistry'
import { ProviderRegistry } from './ai/ProviderRegistry'
import { ProviderConfigurationService } from './ai/ProviderConfigurationService'
import { OpenAICompatibleAdapterFactory } from './ai/providers/openai-compatible/factory'
import { ProviderCredentialVault } from './security/ProviderCredentialVault'
import { ElectronCredentialEncryption } from './security/ElectronCredentialEncryption'
import { ModelCatalogService } from './ai/ModelCatalogService'
import { migrateProductUserData } from './persistence/ProductUserData'
import productIdentity from '../shared/product-identity.json'
import { hasDatabaseRecoveryArtifacts, inspectDatabaseFile, isRecoverableDatabaseCorruption, listDatabaseRecoveryCandidates, restoreDatabaseFile } from './database/recovery'
import packageMetadata from '../package.json'
import { FatalShutdownController, type FatalShutdownEvent } from './runtime/FatalShutdown'
import { createNormalShutdownHandler } from './runtime/NormalShutdown'
import { runPackageSmoke } from './runtime/PackageSmoke'
import { createPackagedRecoveryHarness } from './runtime/PackagedRecoveryHarness'
import { isMainProcessOperational, markMainProcessFatal, markMainProcessTerminated } from './runtime/MainProcessState'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const softwareRendering = process.env.NOCTURNE_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')
if (softwareRendering) app.disableHardwareAcceleration()
process.env.APP_ROOT = path.join(__dirname, '..')
process.env.NOCTURNE_APP_RUNNING = '1'
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
const APP_NAME = productIdentity.displayName
const LEGACY_APP_NAME = productIdentity.legacyUserDataDirectory
const APP_ICON = path.join(process.env.APP_ROOT, 'build', 'icon.png')
app.setName(APP_NAME)
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', migrateProductUserData(
    app.getPath('appData'),
    productIdentity.currentUserDataDirectory,
    LEGACY_APP_NAME,
  ))
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()

let win: BrowserWindow | null = null
let database: LocalDatabase | null = null
let logger: Logger | null = null
let disposeIpc: (() => void | Promise<void>) | null = null
let packageSmokeScheduled = false
let packagedRecoveryScheduled = false
let packagedRecoveryStage = 'bootstrap'
let disposeUpdates: (() => void) | null = null
let providerConfigurations: ProviderConfigurationService | null = null
let providerRegistry: ProviderRegistry | null = null
let modelRegistry: ModelRegistry | null = null
let modelCatalog: ModelCatalogService | null = null
let shutdownResourcesPromise: Promise<void> | null = null

async function disposeWindowIpc() {
  await disposeIpc?.()
  disposeIpc = null
}

async function shutdownResources() {
  if (shutdownResourcesPromise) return shutdownResourcesPromise
  shutdownResourcesPromise = (async () => {
    const failures: unknown[] = []
    try {
      disposeUpdates?.()
    } catch (error) {
      failures.push(error)
    } finally {
      disposeUpdates = null
    }
    try {
      await disposeWindowIpc()
    } catch (error) {
      failures.push(error)
    }

    const currentDatabase = database
    database = null
    try {
      currentDatabase?.close()
    } catch (error) {
      failures.push(error)
    }

    const currentProviders = providerRegistry
    providerRegistry = null
    providerConfigurations = null
    modelCatalog = null
    modelRegistry = null
    try {
      await currentProviders?.dispose()
    } catch (error) {
      failures.push(error)
    }

    try {
      await logger?.flush()
    } catch (error) {
      failures.push(error)
    }

    if (failures.length) throw new Error(`O encerramento encontrou ${failures.length} falha(s) de cleanup.`)
  })()
  return shutdownResourcesPromise
}

function describeFatalError(error: unknown) {
  let text = 'Falha sem representação textual.'
  let message = ''
  let stack = ''
  try {
    if (error instanceof Error) {
      message = redactLogText(error.message).slice(0, 2_000)
      stack = redactLogText(error.stack ?? '').slice(0, 8_000)
      text = `${error.name}\n${error.message}\n${error.stack ?? ''}`
    } else {
      text = String(error)
    }
  } catch { /* preserve a bounded diagnostic even for hostile error values */ }
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(message ? { failureSummary: message } : {}),
    failureFingerprint: diagnosticFingerprint(text),
    ...(stack ? { failureStackFingerprint: diagnosticFingerprint(stack) } : {}),
  }
}

function recordFatalEvent(event: FatalShutdownEvent) {
  const details = {
    appVersion: packageMetadata.version,
    failureType: event.failureType,
    phase: event.phase,
    ...('error' in event ? describeFatalError(event.error) : {}),
    ...('timeoutMs' in event ? { timeoutMs: event.timeoutMs } : {}),
  }
  const messages = {
    fatal: event.failureType === 'rendererLoadFailure'
      ? 'O renderer empacotado não pôde ser carregado; o aplicativo será encerrado.'
      : 'Falha fatal não tratada no processo principal; o aplicativo será encerrado.',
    'cleanup-failed': 'Falha durante o cleanup de uma falha fatal; o aplicativo será encerrado.',
    'cleanup-timeout': 'O cleanup de uma falha fatal excedeu o tempo limite; o aplicativo será encerrado.',
    'exit-failed': 'Não foi possível solicitar o encerramento após uma falha fatal.',
  } as const
  logger?.error('app', messages[event.phase], details)
  try {
    const fingerprint = 'error' in event ? describeFatalError(event.error).failureFingerprint : 'indisponível'
    console.error(`Nocturne Studio: ${messages[event.phase]} [${event.failureType}; ${fingerprint}]`)
  } catch { /* diagnostics must not prevent the fatal exit path */ }
}

const fatalShutdown = new FatalShutdownController({
  onFatal: () => {
    markMainProcessFatal()
    process.exitCode = 1
  },
  onTerminated: markMainProcessTerminated,
  record: recordFatalEvent,
  cleanup: shutdownResources,
  flush: () => logger?.flush(),
  exit: (code) => {
    process.exitCode = code
    try {
      app.exit(code)
    } catch (error) {
      // app.exit normally terminates immediately; process.exit is only the
      // last-resort fallback once cleanup and diagnostic flushing completed.
      try { process.exit(code) } catch { /* preserve the original exit failure for diagnostics */ }
      throw error
    }
  },
})

const normalShutdown = createNormalShutdownHandler({
  shutdown: shutdownResources,
  quit: () => app.quit(),
  exit: (code) => app.exit(code),
  onFailure: async (error) => {
    logger?.error('app', 'O cleanup do encerramento normal encontrou uma falha.', error)
    await logger?.flush()
  },
})

const packagedRecovery = createPackagedRecoveryHarness({
  getWindow: () => win,
  getDatabase: () => database,
  setDatabase: (value) => { database = value },
  createDatabase: (userDataPath) => new LocalDatabase(userDataPath),
  getStage: () => packagedRecoveryStage,
  setStage: (stage) => { packagedRecoveryStage = stage },
})

process.on('uncaughtException', (error) => { void fatalShutdown.handle('uncaughtException', error) })
process.on('unhandledRejection', (reason) => { void fatalShutdown.handle('unhandledRejection', reason) })

function createWindow() {
  if (!isMainProcessOperational()) return
  if (!database || !logger || !providerConfigurations || !modelRegistry || !providerRegistry || !modelCatalog) throw new Error('Serviços do Nocturne não foram inicializados.')
  if (win?.isDestroyed()) {
    void disposeWindowIpc().catch((error) => logger?.error('app', 'O cleanup da janela anterior encontrou uma falha.', error))
    win = null
  }
  const rendererUrl = VITE_DEV_SERVER_URL || new URL(`file://${path.join(RENDERER_DIST, 'index.html')}`).toString()
  const currentWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 720, minHeight: 600,
    title: APP_NAME, icon: APP_ICON, backgroundColor: '#0b0b0e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win = currentWindow
  currentWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    currentWindow.setTitle(APP_NAME)
  })
  currentWindow.setMenuBarVisibility(false)
  currentWindow.webContents.session.setPermissionCheckHandler(() => false)
  currentWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  currentWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') void shell.openExternal(parsed.toString()).catch((error) => logger?.warn('app', 'Não foi possível abrir o link externo.', error))
    } catch { /* deny malformed URL */ }
    return { action: 'deny' }
  })
  currentWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url === rendererUrl
    if (!allowed) event.preventDefault()
  })
  currentWindow.webContents.on('will-frame-navigate', (event) => {
    if (event.url !== rendererUrl) event.preventDefault()
  })

  logger.info('app', 'Janela principal iniciada', { packaged: app.isPackaged, renderer: softwareRendering ? 'software' : 'hardware' })
  disposeIpc = registerIpc(
    currentWindow,
    database,
    logger,
    providerConfigurations,
    {
      list: () => modelRegistry?.list() ?? [],
      refresh: (providerId) => {
        if (!modelCatalog) throw new Error('Catálogo de modelos indisponível.')
        return modelCatalog.refresh(providerId)
      },
    },
    modelRegistry,
    providerRegistry,
  )
  if (
    app.isPackaged &&
    process.env.NOCTURNE_PACKAGE_SMOKE_OUTPUT &&
    !process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT &&
    !packageSmokeScheduled
  ) {
    packageSmokeScheduled = true

    const output = path.resolve(
      process.env.NOCTURNE_PACKAGE_SMOKE_OUTPUT,
    )

    currentWindow.webContents.once('did-finish-load', () => {
      void runPackageSmoke(output, {
        getWindow: () => win,
        getDatabase: () => database,
      })
    })
  }
  if (
    app.isPackaged &&
    process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT &&
    !packagedRecoveryScheduled
  ) {
    packagedRecoveryScheduled = true
    currentWindow.webContents.once('did-finish-load', () => {
      void packagedRecovery.run()
    })
  }
  currentWindow.webContents.on('preload-error', (_event, preloadPath, error) => logger?.error('app', `Falha no preload: ${preloadPath}`, error))
  currentWindow.webContents.on('did-fail-load', (_event, code, description, url) => logger?.error('app', 'Falha ao carregar renderer', { code, description, url }))
  currentWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) logger?.warn('app', 'Console do renderer', { level, fingerprint: diagnosticFingerprint(message), line, source: path.basename(sourceId) })
  })
  currentWindow.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('app', 'Renderer encerrado inesperadamente', details)
    if (!currentWindow.isDestroyed()) setTimeout(() => {
      if (isMainProcessOperational() && !currentWindow.isDestroyed()) {
        try { currentWindow.webContents.reload() } catch (error) { logger?.warn('app', 'Não foi possível recarregar o renderer após a falha.', error) }
      }
    }, 1_000)
  })
  currentWindow.webContents.on('unresponsive', () => logger?.warn('app', 'Renderer não está respondendo'))
  currentWindow.webContents.on('responsive', () => logger?.info('app', 'Renderer voltou a responder'))
  currentWindow.on('closed', () => {
    if (win !== currentWindow) return
    void disposeWindowIpc().catch((error) => logger?.error('app', 'O cleanup da janela encerrada encontrou uma falha.', error))
    win = null
  })
  if (VITE_DEV_SERVER_URL) {
    void currentWindow.loadURL(rendererUrl).catch((error) => logger?.error('app', 'Falha ao carregar o renderer de desenvolvimento.', error))
  } else {
    void currentWindow.loadFile(path.join(RENDERER_DIST, 'index.html')).catch((error) => {
      logger?.error('app', 'Falha ao carregar o renderer empacotado.', error)
      void fatalShutdown.handle('rendererLoadFailure', error)
    })
  }
}

async function initializeServices() {
  if (database || logger || providerConfigurations) return
  const userDataPath = app.getPath('userData')
  await recoverDatabaseIfNeeded(userDataPath)
  database = new LocalDatabase(userDataPath)
  logger = new Logger(app.getPath('logs'), database.getSettings().diagnosticMode === 'true')
  database.setOperationObserver(({ operation, durationMs, failed }) => {
    const details = { operation, durationMs, failed }
    if (failed || durationMs >= 50) logger!.warn('persistence', 'Operação SQLite concluída com atenção.', details)
    else logger!.debug('persistence', 'Operação SQLite concluída.', details)
  })
  modelRegistry = new ModelRegistry()
  providerRegistry = new ProviderRegistry()
  modelCatalog = new ModelCatalogService(
    providerRegistry,
    modelRegistry,
    database.modelCatalog,
  )
  try {
    logger.info(
      'persistence',
      'Catálogo de modelos restaurado',
      modelCatalog.initialize(),
    )
  } catch (error) {
    logger.error(
      'persistence',
      'O catálogo de modelos persistido não pôde ser restaurado',
      error,
    )
  }
  providerConfigurations = new ProviderConfigurationService(
    database.providerConfigurations,
    new ProviderCredentialVault(
      userDataPath,
      new ElectronCredentialEncryption(),
    ),
    providerRegistry,
    new OpenAICompatibleAdapterFactory(modelRegistry),
    (id) => {
      database!.modelCatalog.deleteProviderModels(id)
      modelRegistry!.deleteProviderModels(id)
    },
  )
  try {
    const initialized = await providerConfigurations.initialize()
    logger.info('persistence', 'Configurações de Providers inicializadas', initialized)
  } catch (error) {
    logger.error(
      'persistence',
      'O subsistema de Providers iniciou em estado degradado',
      error,
    )
  }
}

async function recoverDatabaseIfNeeded(userDataPath: string) {
  const databasePath = path.join(userDataPath, 'nocturne.db')
  const databaseMissing = !fs.existsSync(databasePath)
  if (databaseMissing && !hasDatabaseRecoveryArtifacts(userDataPath)) {
    const candidates = await listDatabaseRecoveryCandidates(userDataPath)
    if (!candidates.length) return
  }
  try {
    if (!databaseMissing) {
      inspectDatabaseFile(databasePath)
      return
    }
  } catch (error) {
    if (!isRecoverableDatabaseCorruption(error)) {
      throw new Error(`Não foi possível validar o banco local. Verifique as permissões e o acesso ao arquivo ${databasePath}. Detalhe: ${error instanceof Error ? error.message : String(error)}`)
    }
    await restoreCorruptDatabase(userDataPath, databasePath, error)
    return
  }
  await restoreCorruptDatabase(userDataPath, databasePath, new Error('O banco local desapareceu durante uma operação de recuperação.'))
}

async function restoreCorruptDatabase(userDataPath: string, databasePath: string, failure: unknown) {
  const candidates = await listDatabaseRecoveryCandidates(userDataPath)
  const latest = candidates[0]
  if (!latest) {
    throw new Error(`O banco local ${fs.existsSync(databasePath) ? 'está corrompido' : 'não está disponível'} e nenhum ponto de recuperação válido foi encontrado. Os artefatos de recuperação foram preservados em ${userDataPath}. Detalhe: ${failure instanceof Error ? failure.message : String(failure)}`)
  }
  const response = await dialog.showMessageBox({
    type: 'error',
    title: 'Recuperar banco de dados?',
    message: 'O banco local falhou na verificação de integridade.',
    detail: `Há um ponto de recuperação compatível de ${new Date(latest.modifiedAt).toLocaleString('pt-BR')}. O banco atual será preservado em quarentena antes da restauração.\n\nOrigem: ${latest.path}`,
    buttons: ['Encerrar sem alterar', 'Restaurar ponto de recuperação'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (response.response !== 1) throw new Error('A recuperação do banco foi cancelada; nenhum arquivo foi alterado.')
  await restoreDatabaseFile(userDataPath, latest.path)
}

app.on('window-all-closed', () => {
  if (process.env.NOCTURNE_PACKAGE_SMOKE_OUTPUT || process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT) return
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => { if (isMainProcessOperational() && BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('second-instance', () => {
  if (!isMainProcessOperational()) return
  if (!win || win.isDestroyed()) { createWindow(); return }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})
app.on('before-quit', (event) => {
  logger?.info('app', 'Encerrando aplicação')
  normalShutdown(event)
})
app.on('child-process-gone', (_event, details) => logger?.error('app', 'Processo filho do Electron encerrado', details))
if (!hasSingleInstanceLock) app.quit()
else void app.whenReady().then(() => {
  return initializeServices()
}).then(() => {
  createWindow()
  if (logger) disposeUpdates = startUpdateService(logger, () => win)
}).catch((error) => {
  if (app.isPackaged && process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT) {
    packagedRecovery.writeStartupFailure(error)
  } else {
    dialog.showErrorBox('Nocturne Studio não pôde iniciar', error instanceof Error ? error.message : String(error))
  }
  void shutdownResources().then(
    () => { process.exitCode = 1; app.exit(1) },
    (cleanupError) => {
      logger?.error('app', 'O cleanup após uma falha de inicialização encontrou um erro.', cleanupError)
      process.exitCode = 1
      app.exit(1)
    },
  )
})
