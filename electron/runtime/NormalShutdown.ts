export interface BeforeQuitEvent {
  preventDefault(): void
}

export interface NormalShutdownHooks {
  shutdown(): Promise<void> | void
  quit(): void
  exit(code: number): void
  onFailure(error: unknown): Promise<void> | void
}

/**
 * Keeps Electron's normal quit event open until asynchronous resources have
 * finished closing. A second quit request is held while the first cleanup is
 * in flight; once cleanup succeeds, the controlled re-entry is allowed.
 */
export function createNormalShutdownHandler(hooks: NormalShutdownHooks, deadlineMs = 15_000) {
  let cleanupCompleted = false
  let cleanupPromise: Promise<void> | null = null

  return (event: BeforeQuitEvent): Promise<void> | undefined => {
    if (cleanupCompleted) return
    event.preventDefault()
    if (cleanupPromise) return cleanupPromise

    cleanupPromise = bounded(Promise.resolve().then(() => hooks.shutdown()), deadlineMs, 'O cleanup excedeu o prazo de encerramento.')
      .then(() => {
        cleanupCompleted = true
        hooks.quit()
      })
      .catch(async (error: unknown) => {
        cleanupCompleted = true
        try {
          await bounded(Promise.resolve().then(() => hooks.onFailure(error)), Math.min(deadlineMs, 5_000), 'O relato da falha excedeu o prazo.')
        } catch {
          // A failure reporter cannot hold Electron shutdown open indefinitely.
        } finally { hooks.exit(1) }
      })
    return cleanupPromise
  }
}

async function bounded<T>(operation: Promise<T>, deadlineMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), deadlineMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
