export type FatalFailureType = 'uncaughtException' | 'unhandledRejection' | 'rendererLoadFailure'
export type FatalShutdownState = 'healthy' | 'fatal-shutdown' | 'terminated'

export type FatalShutdownEvent =
  | { phase: 'fatal'; failureType: FatalFailureType; error: unknown }
  | { phase: 'cleanup-failed'; failureType: FatalFailureType; error: unknown }
  | { phase: 'cleanup-timeout'; failureType: FatalFailureType; timeoutMs: number }
  | { phase: 'exit-failed'; failureType: FatalFailureType; error: unknown }

export interface FatalShutdownHooks {
  onFatal?: () => void
  onTerminated?: () => void
  record(event: FatalShutdownEvent): void
  cleanup(): void | Promise<void>
  flush?(): void | Promise<void>
  exit(code: number): void
  timeoutMs?: number
  setTimeout?: (callback: () => void, delay: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

const DEFAULT_TIMEOUT_MS = 5_000

export class FatalShutdownController {
  private state: FatalShutdownState = 'healthy'
  private completion: Promise<void> | null = null

  constructor(private readonly hooks: FatalShutdownHooks) {}

  getState() {
    return this.state
  }

  handle(failureType: FatalFailureType, error: unknown) {
    if (this.completion) return this.completion
    this.state = 'fatal-shutdown'
    try { this.hooks.onFatal?.() } catch { /* a fatal transition must not be interrupted by its observer */ }
    this.record({ phase: 'fatal', failureType, error })
    this.completion = this.run(failureType)
    return this.completion
  }

  private async run(failureType: FatalFailureType) {
    const timeoutMs = this.hooks.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const setTimer = this.hooks.setTimeout ?? ((callback: () => void, delay: number) => setTimeout(callback, delay))
    const clearTimer = this.hooks.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    let timeoutHandle: unknown
    let timedOut = false
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimer(() => {
        timedOut = true
        resolve('timeout')
      }, timeoutMs)
    })
    const cleanup = (async () => {
      try {
        await this.hooks.cleanup()
      } catch (cleanupError) {
        this.record({ phase: 'cleanup-failed', failureType, error: cleanupError })
      }
      try {
        await this.hooks.flush?.()
      } catch (flushError) {
        this.record({ phase: 'cleanup-failed', failureType, error: flushError })
      }
      return 'completed' as const
    })()

    const result = await Promise.race([cleanup, timeout])
    if (result === 'timeout' || timedOut) {
      this.record({ phase: 'cleanup-timeout', failureType, timeoutMs })
    } else if (timeoutHandle !== undefined) {
      clearTimer(timeoutHandle)
    }
    this.state = 'terminated'
    try { this.hooks.onTerminated?.() } catch { /* termination must proceed even if its observer fails */ }
    try {
      this.hooks.exit(1)
    } catch (exitError) {
      this.record({ phase: 'exit-failed', failureType, error: exitError })
    }
  }

  private record(event: FatalShutdownEvent) {
    try { this.hooks.record(event) } catch { /* diagnostics must never prevent termination */ }
  }
}
