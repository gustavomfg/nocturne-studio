import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
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
let disposeIpc: (() => void) | null = null
let packageSmokeScheduled = false
let packagedRecoveryScheduled = false
let packagedRecoveryStage = 'bootstrap'
let disposeUpdates: (() => void) | null = null
let providerConfigurations: ProviderConfigurationService | null = null
let providerRegistry: ProviderRegistry | null = null
let modelRegistry: ModelRegistry | null = null
let modelCatalog: ModelCatalogService | null = null
let shutdownResourcesPromise: Promise<void> | null = null

function disposeWindowIpc() {
  disposeIpc?.()
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
      disposeWindowIpc()
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

process.on('uncaughtException', (error) => { void fatalShutdown.handle('uncaughtException', error) })
process.on('unhandledRejection', (reason) => { void fatalShutdown.handle('unhandledRejection', reason) })

function createWindow() {
  if (!isMainProcessOperational()) return
  if (!database || !logger || !providerConfigurations || !modelRegistry || !providerRegistry || !modelCatalog) throw new Error('Serviços do Nocturne não foram inicializados.')
  if (win?.isDestroyed()) {
    disposeWindowIpc()
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
      void runPackageSmoke(output)
    })
  }
  if (
    app.isPackaged &&
    process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT &&
    !packagedRecoveryScheduled
  ) {
    packagedRecoveryScheduled = true
    currentWindow.webContents.once('did-finish-load', () => {
      void runPackagedRecoveryHarness()
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
    disposeWindowIpc()
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

async function runPackageSmoke(output: string) {
  try {
    const preload = await win?.webContents.executeJavaScript(`(async () => {
      const api = window.nocturne
      const geolocation = await navigator.permissions.query({ name: 'geolocation' }).then((result) => result.state).catch(() => 'denied')
      const externalWindowsDenied = window.open('about:blank', '_blank') === null
      return { available: Boolean(api), settings: typeof api?.settings?.get === 'function', channels: api ? Object.keys(api).sort() : [], geolocation, externalWindowsDenied }
    })()` ) as { available: boolean; settings: boolean; channels: string[]; geolocation: PermissionState; externalWindowsDenied: boolean } | undefined
    const originalUrl = win?.webContents.getURL()
    await win?.webContents.executeJavaScript(`(() => {
      const link = document.createElement('a')
      link.href = 'https://example.invalid/nocturne-package-smoke'
      document.body.append(link)
      link.click()
      link.remove()
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const smokeWorkspace = app.getPath('userData')
    const conversation = database?.createConversation(smokeWorkspace)
    if (conversation) database?.addMessage(conversation.id, 'user', 'package-smoke')
    const sqlite = Boolean(conversation && database?.listMessages(conversation.id)[0]?.content === 'package-smoke')
    const lifecycle = await recreateWindowForPackageSmoke()
    const preferences = (win?.webContents as Electron.WebContents & { getLastWebPreferences(): Electron.WebPreferences } | undefined)?.getLastWebPreferences()
    const security = { contextIsolation: preferences?.contextIsolation === true, nodeIntegration: preferences?.nodeIntegration === false, sandbox: preferences?.sandbox === true }
    const finalUrl = win?.webContents.getURL()
    const navigation = { externalWindowsDenied: preload?.externalWindowsDenied === true, unexpectedNavigationBlocked: Boolean(originalUrl && finalUrl === originalUrl), originalUrl, finalUrl }
    const ok = Boolean(preload?.available && preload.settings && preload.geolocation === 'denied' && sqlite && lifecycle.closed && lifecycle.activated && lifecycle.secondInstanceReused && lifecycle.api && lifecycle.settings && Object.values(security).every(Boolean) && navigation && Object.values(navigation).every(Boolean))
    fs.writeFileSync(output, `${JSON.stringify({ ok, packaged: app.isPackaged, preload, sqlite, lifecycle, security, navigation })}\n`, { encoding: 'utf8', mode: 0o600 })
    app.quit()
  } catch (error) {
    fs.writeFileSync(output, `${JSON.stringify({ ok: false, packaged: app.isPackaged, error: error instanceof Error ? error.message : String(error) })}\n`, { encoding: 'utf8', mode: 0o600 })
    app.exit(1)
  }
}

type PackagedRecoveryMode = 'fixture' | 'verify' | 'verify-historical' | 'engine-restore'

interface PackagedRecoveryContext {
  root: string
  output: string
  workspace: string
  mode: PackagedRecoveryMode
}

function isPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function setPackagedRecoveryStage(stage: string) {
  packagedRecoveryStage = stage
}

function sanitizePackagedRecoveryText(value: string) {
  const knownRoots = [process.cwd(), os.homedir(), path.resolve(os.tmpdir()), process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT].filter((entry): entry is string => Boolean(entry))
  let text = redactLogText(value)
  for (const root of knownRoots) text = text.split(root).join('<redacted-root>')
  text = text.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s'"`]|\\ )+/g, '<redacted-path>')
  return text.slice(0, 2_000)
}

function packagedRecoveryOutputContext() {
  const rootValue = process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT
  const outputValue = process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT
  if (!rootValue || !outputValue) return null
  const root = path.resolve(rootValue)
  const output = path.resolve(outputValue)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (!isPathInside(temporaryRoot, root) || !isPathInside(root, output)) return null
  return { root, output }
}

function inspectPackagedRecoveryPaths() {
  const rootValue = process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT
  const outputValue = process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT
  const temporaryRoot = path.resolve(os.tmpdir())
  const root = rootValue ? path.resolve(rootValue) : null
  const output = outputValue ? path.resolve(outputValue) : null
  const userData = path.resolve(app.getPath('userData'))
  const canonical = (value: string | null) => {
    if (!value) return null
    try { return path.resolve(fs.realpathSync.native(value)) } catch { return null }
  }
  const canonicalTemporaryRoot = canonical(temporaryRoot)
  const canonicalRoot = canonical(root)
  const canonicalUserData = canonical(userData)
  return {
    rootLexicalInsideTemporary: Boolean(root && isPathInside(temporaryRoot, root)),
    outputLexicalInsideRoot: Boolean(root && output && isPathInside(root, output)),
    userDataExists: fs.existsSync(userData),
    userDataLexicalInsideTemporary: isPathInside(temporaryRoot, userData),
    canonicalTemporaryAvailable: Boolean(canonicalTemporaryRoot),
    canonicalRootAvailable: Boolean(canonicalRoot),
    canonicalUserDataAvailable: Boolean(canonicalUserData),
    canonicalRootInsideTemporary: Boolean(canonicalTemporaryRoot && canonicalRoot && isPathInside(canonicalTemporaryRoot, canonicalRoot)),
    canonicalUserDataInsideTemporary: Boolean(canonicalTemporaryRoot && canonicalUserData && isPathInside(canonicalTemporaryRoot, canonicalUserData)),
    temporaryAliasChanged: Boolean(canonicalTemporaryRoot && canonicalTemporaryRoot !== temporaryRoot),
    rootAliasChanged: Boolean(canonicalRoot && root && canonicalRoot !== root),
    userDataAliasChanged: Boolean(canonicalUserData && canonicalUserData !== userData),
  }
}

function writePackagedRecoveryFailure(error: unknown, phase: string) {
  const outputContext = packagedRecoveryOutputContext()
  if (!outputContext) return
  try {
    fs.mkdirSync(path.dirname(outputContext.output), { recursive: true, mode: 0o700 })
    const errorMessage = error instanceof Error ? error.message : String(error)
    fs.writeFileSync(outputContext.output, `${JSON.stringify({
      packaged: app.isPackaged,
      mode: process.env.NOCTURNE_PACKAGED_RECOVERY_MODE ?? null,
      ok: false,
      phase,
      stage: packagedRecoveryStage,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: sanitizePackagedRecoveryText(errorMessage),
      failureFingerprint: diagnosticFingerprint(`${errorMessage}\n${error instanceof Error ? error.stack ?? '' : ''}`),
      pathDiagnostics: inspectPackagedRecoveryPaths(),
    })}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch { /* diagnostics must not replace the original failure */ }
}

function packagedRecoveryContext(): PackagedRecoveryContext {
  const rootValue = process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT
  const outputValue = process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT
  const workspaceValue = process.env.NOCTURNE_PACKAGED_RECOVERY_WORKSPACE
  const mode = process.env.NOCTURNE_PACKAGED_RECOVERY_MODE as PackagedRecoveryMode | undefined
  if (!rootValue || !outputValue || !workspaceValue || !mode || !['fixture', 'verify', 'verify-historical', 'engine-restore'].includes(mode)) {
    throw new Error('Configuração incompleta do harness empacotado de recovery.')
  }
  const root = path.resolve(rootValue)
  const output = path.resolve(outputValue)
  const workspace = path.resolve(workspaceValue)
  const temporaryRoot = path.resolve(os.tmpdir())
  const userData = path.resolve(app.getPath('userData'))
  if (!isPathInside(temporaryRoot, root) || !isPathInside(root, output) || !isPathInside(root, workspace) || !isPathInside(root, userData)) {
    throw new Error('O harness empacotado exige userData, workspace e relatório dentro de um diretório temporário isolado.')
  }
  return { root, output, workspace, mode }
}

function writePackagedRecoveryResult(context: PackagedRecoveryContext, value: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(context.output), { recursive: true, mode: 0o700 })
  fs.writeFileSync(context.output, `${JSON.stringify({
    packaged: app.isPackaged,
    mode: context.mode,
    stage: packagedRecoveryStage,
    ...value,
  })}\n`, { encoding: 'utf8', mode: 0o600 })
}

function packagedRecoveryState(context: PackagedRecoveryContext) {
  if (!database) throw new Error('Banco indisponível no harness empacotado de recovery.')
  const conversations = database.listConversations()
  const conversation = conversations.find((item) => item.workspace === context.workspace)
  const messages = conversation ? database.listMessages(conversation.id) : []
  const artifacts = conversation ? database.listArtifacts(conversation.id) : []
  const suggestions = conversation ? database.listSuggestions(conversation.id) : []
  const memories = database.listBrainMemoryPage(context.workspace, 0, 50).items
  const workspaceRows = database.listWorkspaces()
  return {
    schemaVersion: database.exportData().schemaVersion,
    records: {
      workspaces: workspaceRows.length,
      conversations: conversations.length,
      messages: messages.length,
      artifacts: artifacts.length,
      suggestions: suggestions.length,
      memories: memories.length,
    },
    markers: {
      conversation: Boolean(conversation?.title === 'PACKAGED_RECOVERY_CONVERSATION'),
      messageA: messages.some((message) => message.content === 'PACKAGED_RECOVERY_MESSAGE_A'),
      messageB: messages.some((message) => message.content === 'PACKAGED_RECOVERY_MESSAGE_B'),
      artifact: artifacts.some((artifact) => artifact.content === 'PACKAGED_RECOVERY_ARTIFACT'),
      suggestion: suggestions.some((suggestion) => suggestion.title === 'PACKAGED_RECOVERY_SUGGESTION'),
      memory: memories.some((memory) => memory.content === 'PACKAGED_RECOVERY_MEMORY'),
      setting: database.getSettings().packagedRecoverySetting === 'PACKAGED_RECOVERY_SETTING',
    },
    historicalMarkers: {
      message: messages.some((message) => message.content === 'PACKAGED_RECOVERY_HISTORICAL_MESSAGE'),
      setting: database.getSettings().packagedHistoricalSetting === 'PACKAGED_RECOVERY_HISTORICAL',
    },
    workspace: {
      historyPresent: workspaceRows.some((item) => item.path === context.workspace),
      filesystemPresent: fs.existsSync(context.workspace),
      // The renderer-facing list applies WorkspaceTrust to the persisted row.
      authorizationRefusedWhenMissing: false,
    },
  }
}

async function runPackagedRecoveryHarness() {
  try {
    setPackagedRecoveryStage('validate-environment')
    const context = packagedRecoveryContext()
    setPackagedRecoveryStage('validate-user-data')
    if (!database) throw new Error('Banco indisponível no harness empacotado de recovery.')
    if (context.mode === 'fixture') {
      setPackagedRecoveryStage('prepare-fixture')
      fs.mkdirSync(context.workspace, { recursive: true, mode: 0o700 })
      setPackagedRecoveryStage('write-fixture')
      fs.writeFileSync(path.join(context.workspace, 'PACKAGED_RECOVERY_WORKSPACE.md'), 'PACKAGED_RECOVERY_WORKSPACE', { encoding: 'utf8', mode: 0o600 })
      const conversation = database.createConversation(context.workspace)
      database.renameFromPrompt(conversation.id, 'PACKAGED_RECOVERY_CONVERSATION')
      database.addMessage(conversation.id, 'user', 'PACKAGED_RECOVERY_MESSAGE_A')
      database.addMessage(conversation.id, 'assistant', 'PACKAGED_RECOVERY_MESSAGE_B')
      database.addArtifact(conversation.id, context.workspace, 'markdown', 'PACKAGED_RECOVERY_ARTIFACT', 'PACKAGED_RECOVERY_WORKSPACE.md', 'PACKAGED_RECOVERY_ARTIFACT')
      database.setWorkspaceMemory(context.workspace, 'PACKAGED_RECOVERY_MEMORY')
      database.addSuggestion(conversation.id, context.workspace, {
        title: 'PACKAGED_RECOVERY_SUGGESTION',
        description: 'Fixture sintético de recuperação empacotada.',
        reasoning: 'Exercitar preservação semântica.',
        category: 'testing',
        severity: 'low',
        affectedFiles: ['PACKAGED_RECOVERY_WORKSPACE.md'],
        proposedChanges: 'Nenhuma alteração.',
        expectedBenefits: ['Evidência reproduzível.'],
        complexity: 'low',
        risk: 'low',
        evidence: [{ source: 'packaged-recovery', detail: 'Fixture sintético.' }],
        confidence: 100,
        source: 'packaged-recovery',
        responsible: 'harness',
      })
      database.createBrainMemory(context.workspace, {
        kind: 'decision',
        scope: 'workspace',
        content: 'PACKAGED_RECOVERY_MEMORY',
        confidence: 100,
        sourceType: 'manual',
        status: 'active',
      })
      database.setSettings({ packagedRecoverySetting: 'PACKAGED_RECOVERY_SETTING' })
    }
    if (context.mode === 'engine-restore') {
      setPackagedRecoveryStage('open-database')
      const userDataPath = app.getPath('userData')
      const databasePath = path.join(userDataPath, 'nocturne.db')
      const candidateName = fs.readdirSync(userDataPath).find((name) => name.startsWith('nocturne.db.recovery-engine'))
      if (!candidateName) throw new Error('Candidato do engine smoke não encontrado.')
      database.close()
      database = null
      fs.truncateSync(databasePath, 32)
      const quarantine = await restoreDatabaseFile(userDataPath, path.join(userDataPath, candidateName))
      database = new LocalDatabase(userDataPath)
      const state = packagedRecoveryState(context)
      setPackagedRecoveryStage('write-report')
      writePackagedRecoveryResult(context, {
        ok: Object.values(state.markers).every(Boolean),
        phase: 'engine-restore',
        recoveryEngine: { restored: true, corruptOriginalPreserved: fs.existsSync(path.join(quarantine, 'nocturne.db')) },
        state,
      })
    } else if (context.mode === 'fixture') {
      const state = packagedRecoveryState(context)
      setPackagedRecoveryStage('write-report')
      writePackagedRecoveryResult(context, { ok: Object.values(state.markers).every(Boolean), phase: context.mode, state })
    } else {
      setPackagedRecoveryStage('open-database')
      const state = packagedRecoveryState(context)
      if (context.mode === 'verify-historical') {
        const historical = Object.values(state.historicalMarkers).every(Boolean)
        setPackagedRecoveryStage('write-report')
        writePackagedRecoveryResult(context, { ok: historical, phase: 'historical-startup', state })
      } else {
        const markers = Object.values(state.markers).every(Boolean)
        const workspaceRows = await win?.webContents.executeJavaScript('window.nocturne.workspace.list()') as Array<{ path?: string; authorized?: boolean }> | undefined
        const missingWorkspace = workspaceRows?.find((item) => item.path === context.workspace)
        state.workspace.authorizationRefusedWhenMissing = !state.workspace.filesystemPresent && missingWorkspace?.authorized === false
        setPackagedRecoveryStage('write-report')
        writePackagedRecoveryResult(context, { ok: markers, phase: context.mode, state })
      }
    }
    setPackagedRecoveryStage('shutdown')
    app.quit()
  } catch (error) {
    writePackagedRecoveryFailure(error, 'harness-failure')
    app.exit(1)
  }
}

function writePackagedRecoveryStartupFailure(error: unknown) {
  setPackagedRecoveryStage('startup')
  writePackagedRecoveryFailure(error, 'startup-failure')
}

async function recreateWindowForPackageSmoke() {
  const previousWindow = win
  if (!previousWindow) throw new Error('A janela do smoke não foi criada.')
  const closed = new Promise<void>((resolve) => previousWindow.once('closed', resolve))
  previousWindow.close()
  await closed
  if (typeof app.emit !== 'function') throw new Error('O harness não oferece eventos de aplicação.')
  app.emit('activate')
  const activatedWindow = win
  if (!activatedWindow) throw new Error('O evento activate não recriou a janela do smoke.')
  await waitForWindowLoad(activatedWindow)
  app.emit('second-instance')
  const secondInstanceReused = win === activatedWindow && !activatedWindow.isDestroyed()
  const result = await activatedWindow.webContents.executeJavaScript(`(async () => {
    const api = window.nocturne
    let settings = false
    try { await api?.settings?.get(); settings = true } catch { /* handler ausente */ }
    return { recreated: true, api: Boolean(api), settings }
  })()` ) as { recreated: boolean; api: boolean; settings: boolean }
  return { closed: true, activated: result.recreated, secondInstanceReused, api: result.api, settings: result.settings }
}

async function waitForWindowLoad(window: BrowserWindow) {
  if (!window.webContents.isLoading()) return
  await new Promise<void>((resolve, reject) => {
    const onLoad = () => { cleanup(); resolve() }
    const onFail = (_event: Electron.Event, code: number, description: string) => {
      cleanup()
      reject(new Error(`A janela recriada falhou ao carregar (${code}): ${description}`))
    }
    const cleanup = () => {
      window.webContents.removeListener('did-finish-load', onLoad)
      window.webContents.removeListener('did-fail-load', onFail)
    }
    window.webContents.once('did-finish-load', onLoad)
    window.webContents.once('did-fail-load', onFail)
  })
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
app.on('before-quit', () => {
  logger?.info('app', 'Encerrando aplicação')
  void shutdownResources().catch((error) => logger?.error('app', 'O cleanup do encerramento normal encontrou uma falha.', error))
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
    writePackagedRecoveryStartupFailure(error)
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
