import { app, BrowserWindow } from 'electron'
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { Logger } from '../logging/Logger'
import type { UpdateCheckTrigger, UpdateErrorStage, UpdatePlatform, UpdateState, UpdateStateListener } from '../../shared/updates'

const CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

export interface UpdateService {
  start(): void
  getCurrentState(): UpdateState
  checkForUpdates(trigger?: UpdateCheckTrigger): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  retryDownload(): Promise<UpdateState>
  installUpdate(): Promise<UpdateState>
  subscribe(listener: UpdateStateListener): () => void
  dispose(): void
}

export interface UpdateServiceOptions {
  currentVersion?: string
  platform?: NodeJS.Platform
  packaged?: boolean
  supported?: boolean
  autoStart?: boolean
  now?: () => Date
}

export function startUpdateService(
  logger: Logger,
  getWindow: () => BrowserWindow | null,
  updater: AppUpdater = getAutoUpdater(),
  options: UpdateServiceOptions = {},
): UpdateService {
  const currentVersion = options.currentVersion ?? readCurrentVersion()
  const platform = toUpdatePlatform(options.platform ?? process.platform)
  const packaged = options.packaged ?? app.isPackaged
  const packageSmoke = Boolean(process.env.NOCTURNE_PACKAGE_SMOKE_OUTPUT)
  const supported = options.supported ?? isSupportedTarget(platform, packaged, packageSmoke)
  const now = options.now ?? (() => new Date())
  const listeners = new Set<UpdateStateListener>()
  let state: UpdateState = supported
    ? { status: 'idle', currentVersion, platform, lastCheckedAt: null }
    : { status: 'unsupported', currentVersion, platform, reason: unsupportedReason(platform, packaged, packageSmoke) }
  let disposed = false
  let checkingPromise: Promise<UpdateState> | null = null
  let downloadPromise: Promise<UpdateState> | null = null
  let installRequested = false
  let availableUpdate: UpdateInfo | null = null
  let activeCheckTrigger: UpdateCheckTrigger = 'automatic'
  let lastLoggedProgress = -10
  let initialCheck: ReturnType<typeof setTimeout> | null = null
  let recurringCheck: ReturnType<typeof setInterval> | null = null
  let started = false

  const setProgress = (value: number) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.setProgressBar(value)
  }

  const publish = (next: UpdateState) => {
    if (disposed) return
    state = next
    for (const listener of listeners) {
      try {
        listener(next)
      } catch (error) {
        logger.warn('update', 'Um listener de estado de atualização falhou.', error)
      }
    }
  }

  const setError = (stage: UpdateErrorStage, error: unknown, version: string | null, recoverable: boolean) => {
    setProgress(-1)
    const message = userMessageForStage(stage)
    publish({ status: 'error', currentVersion, platform, stage, message, recoverable, version })
    logger.warn('update', `Falha na etapa ${stage} da atualização.`, error)
  }

  const setAvailable = (info: UpdateInfo, discoveredBy: UpdateCheckTrigger = activeCheckTrigger) => {
    if (disposed || state.status === 'downloading' || state.status === 'ready') return
    availableUpdate = info
    publish({
      status: 'available',
      currentVersion,
      platform,
      version: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null,
      discoveredBy,
    })
    logger.info('update', 'Atualização disponível.', { version: info.version, discoveredBy })
  }

  const onAvailable = (info: UpdateInfo) => setAvailable(info)
  const onNotAvailable = () => {
    if (disposed || state.status === 'downloading' || state.status === 'ready' || state.status === 'available') return
    const lastCheckedAt = now().toISOString()
    publish({ status: 'up-to-date', currentVersion, platform, lastCheckedAt })
    logger.info('update', 'Nenhuma atualização disponível.', { lastCheckedAt })
  }
  const onProgress = (progress: ProgressInfo) => {
    if (disposed || state.status !== 'downloading') return
    const percent = clampPercent(progress.percent)
    const transferred = finiteNumber(progress.transferred)
    const total = finiteNumber(progress.total)
    const bytesPerSecond = finiteNumber(progress.bytesPerSecond)
    setProgress(percent / 100)
    publish({ status: 'downloading', currentVersion, platform, version: state.version, percent, transferred, total, bytesPerSecond })
    const rounded = Math.floor(percent / 10) * 10
    if (rounded > lastLoggedProgress || percent >= 100) {
      lastLoggedProgress = rounded
      logger.debug('update', 'Progresso do download da atualização.', { percent: Math.round(percent) })
    }
  }
  const onDownloaded = (info: UpdateInfo) => {
    if (disposed) return
    availableUpdate = info
    downloadPromise = null
    setProgress(-1)
    publish({
      status: 'ready',
      currentVersion,
      platform,
      version: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null,
    })
    logger.info('update', 'Download da atualização concluído.', { version: info.version })
  }
  const onError = (error: Error) => {
    if (disposed) return
    if (state.status === 'downloading') {
      if (!downloadPromise) setError(classifyDownloadStage(error), error, state.version, true)
      return
    }
    if (state.status === 'checking') {
      if (!checkingPromise) setError(classifyCheckStage(error), error, null, true)
      return
    }
    logger.warn('update', 'Falha no serviço de atualização.', error)
  }

  const checkForUpdates = (trigger: UpdateCheckTrigger = 'manual'): Promise<UpdateState> => {
    if (disposed) return Promise.resolve(state)
    if (!supported) return Promise.resolve(state)
    if (checkingPromise) return checkingPromise
    if (state.status === 'available' || state.status === 'downloading' || state.status === 'ready') return Promise.resolve(state)

    activeCheckTrigger = trigger
    publish({ status: 'checking', currentVersion, platform, trigger })
    logger.info('update', 'Consulta de atualizações iniciada.', { trigger })
    checkingPromise = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then((result) => {
        if (state.status === 'checking') {
          if (result?.isUpdateAvailable && result.updateInfo) setAvailable(result.updateInfo, trigger)
          else onNotAvailable()
        }
        return state
      })
      .catch((error) => {
        if (state.status === 'checking') setError(classifyCheckStage(error), error, null, true)
        return state
      })
      .finally(() => { checkingPromise = null })
    return checkingPromise
  }

  const downloadUpdate = (): Promise<UpdateState> => {
    if (disposed || !supported) return Promise.resolve(state)
    if (downloadPromise) return downloadPromise
    const updateInfo = availableUpdate
    const canDownload = Boolean(updateInfo) && (
      state.status === 'available' ||
      (state.status === 'error' && (state.stage === 'download' || state.stage === 'validation'))
    )
    if (!canDownload || !updateInfo) throw new UpdateOperationError('O download só pode começar quando uma atualização estiver disponível.')

    lastLoggedProgress = -10
    publish({ status: 'downloading', currentVersion, platform, version: updateInfo.version, percent: 0, transferred: null, total: null, bytesPerSecond: null })
    setProgress(0)
    logger.info('update', 'Download da atualização iniciado.', { version: updateInfo.version })
    downloadPromise = Promise.resolve()
      .then(() => updater.downloadUpdate())
      .then(() => state)
      .catch((error) => {
        if (state.status === 'downloading') setError(classifyDownloadStage(error), error, updateInfo.version, true)
        return state
      })
      .finally(() => { downloadPromise = null })
    return downloadPromise
  }

  const retryDownload = () => {
    if (state.status !== 'error' || (state.stage !== 'download' && state.stage !== 'validation')) {
      throw new UpdateOperationError('Não há um download de atualização que possa ser retomado.')
    }
    logger.info('update', 'Retry do download da atualização solicitado.', { version: state.version })
    return downloadUpdate()
  }

  const installUpdate = (): Promise<UpdateState> => {
    if (disposed || !supported) return Promise.resolve(state)
    if (installRequested) return Promise.resolve(state)
    if (state.status !== 'ready') throw new UpdateOperationError('A atualização ainda não está pronta para instalação.')

    const version = state.version
    installRequested = true
    logger.info('update', 'Instalação da atualização solicitada.', { version })
    return Promise.resolve()
      .then(() => updater.quitAndInstall())
      .then(() => state)
      .catch((error) => {
        installRequested = false
        setError('install', error, version, true)
        return state
      })
  }

  const start = () => {
    if (started || disposed || !supported) return
    started = true
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.logger = {
      debug: (message) => logger.debug('update', String(message)),
      info: (message) => logger.info('update', String(message)),
      warn: (message) => logger.warn('update', String(message)),
      error: (message) => logger.error('update', String(message)),
    }
    updater.on('update-available', onAvailable)
    updater.on('update-not-available', onNotAvailable)
    updater.on('download-progress', onProgress)
    updater.on('update-downloaded', onDownloaded)
    updater.on('error', onError)
    initialCheck = setTimeout(() => { void checkForUpdates('automatic') }, CHECK_DELAY_MS)
    recurringCheck = setInterval(() => { void checkForUpdates('automatic') }, CHECK_INTERVAL_MS)
  }

  if (options.autoStart !== false) start()

  return {
    start,
    getCurrentState: () => state,
    checkForUpdates,
    downloadUpdate,
    retryDownload,
    installUpdate,
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      if (disposed) return
      disposed = true
      setProgress(-1)
      if (initialCheck) clearTimeout(initialCheck)
      if (recurringCheck) clearInterval(recurringCheck)
      if (started) {
        updater.removeListener('update-available', onAvailable)
        updater.removeListener('update-not-available', onNotAvailable)
        updater.removeListener('download-progress', onProgress)
        updater.removeListener('update-downloaded', onDownloaded)
        updater.removeListener('error', onError)
      }
      listeners.clear()
    },
  }
}

export function formatReleaseNotes(notes: UpdateInfo['releaseNotes']) {
  const content = Array.isArray(notes)
    ? notes.map((entry) => entry.note ?? '').join('\n')
    : notes ?? ''
  return String(content)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`~[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000)
}

class UpdateOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpdateOperationError'
  }
}

function readCurrentVersion() {
  try { return app.getVersion() }
  catch { return 'unknown' }
}

function toUpdatePlatform(platform: NodeJS.Platform): UpdatePlatform {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return 'other'
}

function isSupportedTarget(platform: UpdatePlatform, packaged: boolean, packageSmoke: boolean) {
  if (!packaged || packageSmoke) return false
  if (platform === 'linux') return Boolean(process.env.APPIMAGE)
  return platform === 'windows' || platform === 'macos'
}

function unsupportedReason(platform: UpdatePlatform, packaged: boolean, packageSmoke: boolean) {
  if (!packaged) return 'Atualizações ficam disponíveis somente em uma instalação empacotada.'
  if (packageSmoke) return 'Atualizações ficam desabilitadas durante o smoke empacotado.'
  if (platform === 'linux') return 'Esta instalação Linux não possui auto-update. Use o formato AppImage para atualizar pelo aplicativo.'
  return 'O auto-update não é suportado nesta plataforma.'
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

function finiteNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function classifyCheckStage(error: unknown): UpdateErrorStage {
  const text = errorText(error)
  return /metadata|latest(?:[-.]|\s)|yaml|release info|parse|404/.test(text) ? 'metadata' : 'check'
}

function classifyDownloadStage(error: unknown): UpdateErrorStage {
  const text = errorText(error)
  return /sha512|checksum|signature|integrity|validation|hash/.test(text) ? 'validation' : 'download'
}

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLocaleLowerCase()
  return String(error).toLocaleLowerCase()
}

function userMessageForStage(stage: UpdateErrorStage) {
  return {
    check: 'Não foi possível consultar atualizações.',
    metadata: 'Os metadados da atualização estão indisponíveis.',
    download: 'O download da atualização foi interrompido.',
    validation: 'A atualização não passou na validação de integridade.',
    install: 'Não foi possível instalar a atualização.',
  }[stage]
}

function getAutoUpdater(): AppUpdater {
  return electronUpdater.autoUpdater
}
