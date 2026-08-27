import { describe, expect, it, vi } from 'vitest'
import { createNormalShutdownHandler, type BeforeQuitEvent } from '../electron/runtime/NormalShutdown'

function event() {
  return { preventDefault: vi.fn() } satisfies BeforeQuitEvent
}

describe('encerramento normal assíncrono', () => {
  it('aguarda o cleanup antes de permitir o segundo quit', async () => {
    let resolveCleanup!: () => void
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { resolveCleanup = resolve }))
    const quit = vi.fn()
    const handler = createNormalShutdownHandler({ shutdown, quit, exit: vi.fn(), onFailure: vi.fn() })
    const first = event()
    const second = event()

    const completion = handler(first)
    const secondCompletion = handler(second)
    await Promise.resolve()

    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    expect(second.preventDefault).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(secondCompletion).toBe(completion)
    expect(quit).not.toHaveBeenCalled()

    resolveCleanup()
    await completion

    expect(quit).toHaveBeenCalledTimes(1)
    const final = event()
    handler(final)
    expect(final.preventDefault).not.toHaveBeenCalled()
  })

  it('encerra com código 1 se o cleanup falhar', async () => {
    const failure = new Error('falha de cleanup')
    const onFailure = vi.fn()
    const exit = vi.fn()
    const handler = createNormalShutdownHandler({ shutdown: vi.fn(async () => { throw failure }), quit: vi.fn(), exit, onFailure })

    await handler(event())

    expect(onFailure).toHaveBeenCalledWith(failure)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
