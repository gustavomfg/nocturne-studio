import { describe, expect, it, vi } from 'vitest'
import { FatalShutdownController, type FatalShutdownEvent } from '../electron/runtime/FatalShutdown'

function createHarness(overrides: Partial<ConstructorParameters<typeof FatalShutdownController>[0]> = {}) {
  const events: FatalShutdownEvent[] = []
  const cleanup = vi.fn<() => void | Promise<void>>()
  const exit = vi.fn<(code: number) => void>()
  const hooks: ConstructorParameters<typeof FatalShutdownController>[0] = {
    record: (event) => events.push(event),
    cleanup,
    exit,
    timeoutMs: 50,
    ...overrides,
  }
  return { controller: new FatalShutdownController(hooks), cleanup: hooks.cleanup, exit: hooks.exit, events }
}

describe('política de fatal shutdown do processo principal', () => {
  it.each(['uncaughtException', 'unhandledRejection', 'rendererLoadFailure'] as const)('encerra após %s', async (failureType) => {
    const harness = createHarness()
    await harness.controller.handle(failureType, new Error('falha não tratada'))

    expect(harness.controller.getState()).toBe('terminated')
    expect(harness.cleanup).toHaveBeenCalledTimes(1)
    expect(harness.exit).toHaveBeenCalledWith(1)
    expect(harness.events[0]).toMatchObject({ phase: 'fatal', failureType })
  })

  it('torna a transição idempotente e executa apenas um shutdown', async () => {
    let finishCleanup!: () => void
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { finishCleanup = resolve }))
    const harness = createHarness({ cleanup })
    const first = harness.controller.handle('uncaughtException', new Error('primeira falha'))
    const second = harness.controller.handle('unhandledRejection', new Error('segunda falha'))

    expect(second).toBe(first)
    await Promise.resolve()
    expect(harness.cleanup).toHaveBeenCalledTimes(1)
    finishCleanup()
    await first
    expect(harness.exit).toHaveBeenCalledTimes(1)
    expect(harness.events.filter((event) => event.phase === 'fatal')).toHaveLength(1)
  })

  it('encerra mesmo quando o cleanup falha', async () => {
    const cleanup = vi.fn(async () => { throw new Error('falha ao fechar recurso') })
    const harness = createHarness({ cleanup })
    await harness.controller.handle('uncaughtException', new Error('falha fatal'))

    expect(harness.events.some((event) => event.phase === 'cleanup-failed')).toBe(true)
    expect(harness.exit).toHaveBeenCalledWith(1)
  })

  it('força a saída quando o cleanup não termina no prazo', async () => {
    let triggerTimeout!: () => void
    const cleanup = vi.fn(() => new Promise<void>(() => undefined))
    const harness = createHarness({
      cleanup,
      setTimeout: (callback) => { triggerTimeout = callback; return 'fatal-timeout' },
      clearTimeout: vi.fn(),
    })
    const completion = harness.controller.handle('unhandledRejection', Promise.reject)
    triggerTimeout()
    await completion

    expect(harness.events).toContainEqual({ phase: 'cleanup-timeout', failureType: 'unhandledRejection', timeoutMs: 50 })
    expect(harness.controller.getState()).toBe('terminated')
    expect(harness.exit).toHaveBeenCalledWith(1)
  })

  it('não ativa fatal shutdown para uma falha operacional comum', async () => {
    const harness = createHarness()
    const operation = Promise.reject(new Error('Provider offline'))

    await expect(operation).rejects.toThrow('Provider offline')
    expect(harness.controller.getState()).toBe('healthy')
    expect(harness.cleanup).not.toHaveBeenCalled()
    expect(harness.exit).not.toHaveBeenCalled()
  })

  it('não deixa falha no próprio exit reabrir o fluxo de shutdown', async () => {
    const exit = vi.fn(() => { throw new Error('exit indisponível no harness') })
    const harness = createHarness({ exit })
    await harness.controller.handle('uncaughtException', new Error('falha fatal'))

    expect(harness.controller.getState()).toBe('terminated')
    expect(exit).toHaveBeenCalledTimes(1)
    expect(harness.events.some((event) => event.phase === 'exit-failed')).toBe(true)
  })
})
