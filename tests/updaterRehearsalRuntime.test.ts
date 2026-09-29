import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error Repository scripts are executable JavaScript, not TS modules.
import { closeRehearsalServer, disarmRehearsalUpdater, runRehearsalPhase } from '../scripts/updater-rehearsal-runtime.mjs'

describe('bounded updater rehearsal', () => {
  afterEach(() => vi.useRealTimers())

  it('closes its owned server even when a peer keeps an unfinished HTTP request open', async () => {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback fixture port')
    const accepted = once(server, 'connection')
    const client = connect(address.port, '127.0.0.1')
    try {
      await accepted
      client.write('GET /fixture HTTP/1.1\r\n')
      const closed = closeRehearsalServer(server)
      await runRehearsalPhase('owned server cleanup', () => closed, 500)
      expect(server.listening).toBe(false)
    } finally {
      client.destroy()
      server.closeAllConnections()
      server.close()
    }
  })

  it('fails, rather than inventing completion, when an updater stage never settles', async () => {
    vi.useFakeTimers()
    const result = runRehearsalPhase('download', () => new Promise(() => {}), 100)
    const assertion = expect(result).rejects.toThrow('timed out in download')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a successful result and clears the deadline', async () => {
    vi.useFakeTimers()
    await expect(runRehearsalPhase('verify', async () => 'verified', 100)).resolves.toBe('verified')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disarms the application quit hook, not just updater event listeners', () => {
    const install = vi.fn()
    const updater = { autoInstallOnAppQuit: true, removeAllListeners: vi.fn(), closeServerIfExists: vi.fn() }
    // BaseUpdater registers this on the application, not on the updater.
    const applicationQuit = () => { if (updater.autoInstallOnAppQuit) install() }
    disarmRehearsalUpdater(updater)
    applicationQuit()
    expect(install).not.toHaveBeenCalled()
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.removeAllListeners).toHaveBeenCalledOnce()
    expect(updater.closeServerIfExists).toHaveBeenCalledOnce()
  })
})
