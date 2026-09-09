import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { Logger } from '../electron/logging/Logger'

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
}))

vi.mock('electron-updater', () => ({ default: { autoUpdater: null } }))

import { startUpdateService } from '../electron/updates/UpdateService'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  logger: unknown
  checkForUpdates = vi.fn(async () => null)
  downloadUpdate = vi.fn(async () => [])
  quitAndInstall = vi.fn()
}

const info = { version: '1.1.0', releaseDate: '2026-09-07T10:00:00.000Z', releaseNotes: '## Estabilidade\n- Corrige **recuperação**.' } as UpdateInfo
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger
const window = {
  isDestroyed: () => false,
  setProgressBar: vi.fn(),
}

function createService(updater = new FakeUpdater(), currentVersion = '1.0.1') {
  const service = startUpdateService(
    logger,
    () => window as never,
    updater as unknown as AppUpdater,
    { currentVersion, platform: 'win32', supported: true },
  )
  return { service, updater }
}

describe('serviço de atualização', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.setProgressBar.mockClear()
    vi.clearAllMocks()
  })
  afterEach(() => vi.useRealTimers())

  it('consulta automaticamente sem sobreposição e remove timers e listeners ao encerrar', async () => {
    const { service, updater } = createService()
    let finishCheck: (() => void) | undefined
    updater.checkForUpdates.mockImplementation(() => new Promise((resolve) => { finishCheck = () => resolve(null) }))

    await vi.advanceTimersByTimeAsync(15_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getCurrentState()).toMatchObject({ status: 'checking', currentVersion: '1.0.1' })
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    finishCheck?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getCurrentState().status).toBe('up-to-date')
    expect(updater.listenerCount('update-available')).toBe(1)
    service.dispose()
    expect(updater.listenerCount('update-available')).toBe(0)
    expect(updater.listenerCount('update-not-available')).toBe(0)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('publica update disponível sem abrir diálogo nativo', async () => {
    const { service, updater } = createService()
    const states: string[] = []
    const unsubscribe = service.subscribe((state) => states.push(state.status))

    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: info, versionInfo: info } as never)
    await service.checkForUpdates('automatic')

    expect(service.getCurrentState()).toMatchObject({ status: 'available', version: '1.1.0', discoveredBy: 'automatic', releaseNotes: 'Estabilidade - Corrige recuperação.' })
    expect(states).toEqual(['checking', 'available'])
    expect(logger.info).toHaveBeenCalledWith('update', 'Atualização disponível.', { version: '1.1.0', discoveredBy: 'automatic' })
    unsubscribe()
    service.dispose()
  })

  it('trata 1.0.1 como atualização do cliente 1.0.0', async () => {
    const { service, updater } = createService(new FakeUpdater(), '1.0.0')
    const migrationInfo = { ...info, version: '1.0.1' } as UpdateInfo

    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: migrationInfo, versionInfo: migrationInfo } as never)
    await service.checkForUpdates('manual')

    expect(service.getCurrentState()).toMatchObject({ status: 'available', currentVersion: '1.0.0', version: '1.0.1', discoveredBy: 'manual' })
    service.dispose()
  })

  it('expõe feedback de up-to-date para check manual', async () => {
    const { service, updater } = createService()
    await service.checkForUpdates('manual')

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getCurrentState()).toMatchObject({ status: 'up-to-date', currentVersion: '1.0.1' })
    service.dispose()
  })

  it('mantém download, progresso, ready e install como estados explícitos', async () => {
    const { service, updater } = createService()
    updater.emit('update-available', info)
    expect(service.getCurrentState()).toMatchObject({ status: 'available', version: '1.1.0' })

    const download = service.downloadUpdate()
    expect(service.getCurrentState()).toMatchObject({ status: 'downloading', version: '1.1.0', percent: 0 })
    updater.emit('download-progress', { percent: 37, transferred: 370, total: 1_000, bytesPerSecond: 100 } as ProgressInfo)
    expect(service.getCurrentState()).toMatchObject({ status: 'downloading', percent: 37, transferred: 370, total: 1_000 })
    expect(window.setProgressBar).toHaveBeenCalledWith(0.37)

    updater.emit('update-downloaded', info)
    await download
    expect(service.getCurrentState()).toMatchObject({ status: 'ready', version: '1.1.0' })
    expect(window.setProgressBar).toHaveBeenCalledWith(-1)

    await service.installUpdate()
    await service.installUpdate()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('permite retry depois de uma falha de download sem abrir modal', async () => {
    const { service, updater } = createService()
    updater.emit('update-available', info)
    updater.downloadUpdate
      .mockRejectedValueOnce(new Error('rede indisponível'))
      .mockImplementationOnce(async () => {
        updater.emit('update-downloaded', info)
        return []
      })

    await service.downloadUpdate()
    expect(service.getCurrentState()).toMatchObject({ status: 'error', stage: 'download', recoverable: true })
    await service.retryDownload()
    expect(service.getCurrentState()).toMatchObject({ status: 'ready', version: '1.1.0' })
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('deduplica checks e downloads e rejeita operações em estados inválidos', async () => {
    const { service, updater } = createService()
    let finishCheck: (() => void) | undefined
    updater.checkForUpdates.mockImplementation(() => new Promise((resolve) => { finishCheck = () => resolve(null) }))
    const firstCheck = service.checkForUpdates('manual')
    const secondCheck = service.checkForUpdates('manual')
    expect(firstCheck).toBe(secondCheck)
    await Promise.resolve()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    finishCheck?.()
    await firstCheck

    expect(() => service.installUpdate()).toThrow('ainda não está pronta')
    updater.emit('update-available', info)
    let finishDownload: (() => void) | undefined
    updater.downloadUpdate.mockImplementation(() => new Promise((resolve) => { finishDownload = () => resolve([]) }))
    const firstDownload = service.downloadUpdate()
    const secondDownload = service.downloadUpdate()
    expect(firstDownload).toBe(secondDownload)
    await Promise.resolve()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(() => service.installUpdate()).toThrow('ainda não está pronta')
    finishDownload?.()
    await firstDownload
    service.dispose()
  })

  it('representa alvos sem auto-update como unsupported', async () => {
    const { service, updater } = createService()
    service.dispose()
    const unsupported = startUpdateService(
      logger,
      () => window as never,
      updater as unknown as AppUpdater,
      { currentVersion: '1.0.1', platform: 'linux', packaged: true, supported: false },
    )

    expect(unsupported.getCurrentState()).toMatchObject({ status: 'unsupported', platform: 'linux' })
    await unsupported.checkForUpdates('manual')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(0)
    unsupported.dispose()
  })
})
