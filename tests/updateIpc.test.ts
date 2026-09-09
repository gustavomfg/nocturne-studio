import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type IpcChannel } from '../shared/ipc/channels'
import type { UpdateState } from '../shared/updates'
import { registerUpdateIpc } from '../electron/ipc/registerUpdateIpc'
import type { UpdateService } from '../electron/updates/UpdateService'
import type { SafeIpcMain } from '../electron/ipc/safeIpc'

const state: UpdateState = { status: 'up-to-date', currentVersion: '1.0.1', platform: 'linux', lastCheckedAt: '2026-09-07T10:00:00.000Z' }

describe('IPC de atualização', () => {
  it('expõe comandos nomeados, valida ausência de payload e remove a subscription', async () => {
    const handlers = new Map<IpcChannel, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: IpcChannel, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }),
    } as unknown as SafeIpcMain
    const unsubscribe = vi.fn()
    let listener: ((next: UpdateState) => void) | undefined
    const service = {
      getCurrentState: vi.fn(() => state),
      checkForUpdates: vi.fn(async () => state),
      downloadUpdate: vi.fn(async () => state),
      retryDownload: vi.fn(async () => state),
      installUpdate: vi.fn(async () => state),
      subscribe: vi.fn((next: (nextState: UpdateState) => void) => { listener = next; return unsubscribe }),
      dispose: vi.fn(),
    } as unknown as UpdateService
    const send = vi.fn()
    const cleanup = registerUpdateIpc(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } } as never,
      service,
      ipcMain,
    )

    expect([...handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.updates.check,
      IPC_CHANNELS.updates.download,
      IPC_CHANNELS.updates.getState,
      IPC_CHANNELS.updates.install,
      IPC_CHANNELS.updates.retry,
    ].sort())
    await expect(handlers.get(IPC_CHANNELS.updates.getState)?.({})).resolves.toEqual(state)
    await expect(handlers.get(IPC_CHANNELS.updates.check)?.({})).resolves.toEqual(state)
    expect(service.checkForUpdates).toHaveBeenCalledWith('manual')
    await expect(handlers.get(IPC_CHANNELS.updates.download)?.({})).resolves.toEqual(state)
    await expect(handlers.get(IPC_CHANNELS.updates.retry)?.({})).resolves.toEqual(state)
    await expect(handlers.get(IPC_CHANNELS.updates.install)?.({})).resolves.toEqual(state)
    expect(() => handlers.get(IPC_CHANNELS.updates.check)?.({}, { unexpected: true })).toThrow()

    listener?.({ ...state, status: 'ready', version: '1.1.0', releaseNotes: '', releaseDate: null })
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updates.changed, expect.objectContaining({ status: 'ready', version: '1.1.0' }))
    cleanup()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
