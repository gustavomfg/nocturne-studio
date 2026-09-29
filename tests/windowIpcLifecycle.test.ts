import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { WindowIpcLifecycle } from '../electron/runtime/WindowIpcLifecycle'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

describe('window IPC ownership', () => {
  it('detaches the closing window synchronously and never erases a replacement', async () => {
    const lifecycle = new WindowIpcLifecycle()
    const old = barrier()
    const oldDispose = vi.fn(() => old.promise)
    const newDispose = vi.fn()
    lifecycle.install(oldDispose)
    const closing = lifecycle.dispose()
    expect(oldDispose).toHaveBeenCalledOnce()
    lifecycle.install(newDispose)
    old.release()
    await closing
    await lifecycle.dispose()
    expect(oldDispose).toHaveBeenCalledOnce()
    expect(newDispose).toHaveBeenCalledOnce()
  })

  it('drains both generations before closing real SQLite', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-window-ipc-db-'))
    const database = new LocalDatabase(directory)
    const lifecycle = new WindowIpcLifecycle()
    const old = barrier()
    const recent = barrier()
    let databaseClosed = false
    try {
      lifecycle.install(async () => { await old.promise; database.getSettings() })
      const closing = lifecycle.dispose()
      lifecycle.install(async () => { await recent.promise; database.getSettings() })
      const shutdown = lifecycle.dispose().then(() => { database.close(); databaseClosed = true })
      recent.release()
      // Drain completion microtasks, without a timing-based sleep. The old
      // generation remains blocked at the explicit barrier.
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(databaseClosed).toBe(false)
      old.release()
      await Promise.all([closing, shutdown])
      expect(databaseClosed).toBe(true)
    } finally {
      old.release()
      recent.release()
      await lifecycle.dispose()
      if (!databaseClosed) database.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('waits for remaining resources even when another disposer rejects', async () => {
    const lifecycle = new WindowIpcLifecycle()
    const old = barrier()
    const recent = barrier()
    lifecycle.install(() => old.promise.then(() => { throw new Error('old cleanup failed') }))
    const closing = lifecycle.dispose()
    const closingFailure = expect(closing).rejects.toThrow(/cleanup failed/)
    lifecycle.install(() => recent.promise)
    let settled = false
    const shutdown = lifecycle.dispose().finally(() => { settled = true })
    const shutdownFailure = expect(shutdown).rejects.toThrow(/cleanup failed/)
    old.release()
    await closingFailure
    expect(settled).toBe(false)
    recent.release()
    await shutdownFailure
  })

  it('refuses to overwrite a live registration', async () => {
    const lifecycle = new WindowIpcLifecycle()
    const dispose = vi.fn()
    lifecycle.install(dispose)
    expect(() => lifecycle.install(vi.fn())).toThrow(/anterior/)
    await lifecycle.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
