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
export function createNormalShutdownHandler(hooks: NormalShutdownHooks) {
  let cleanupCompleted = false
  let cleanupPromise: Promise<void> | null = null

  return (event: BeforeQuitEvent): Promise<void> | undefined => {
    if (cleanupCompleted) return
    event.preventDefault()
    if (cleanupPromise) return cleanupPromise

    cleanupPromise = Promise.resolve()
      .then(() => hooks.shutdown())
      .then(() => {
        cleanupCompleted = true
        hooks.quit()
      })
      .catch(async (error: unknown) => {
        cleanupCompleted = true
        try { await hooks.onFailure(error) } finally { hooks.exit(1) }
      })
    return cleanupPromise
  }
}
