type Disposer = () => void | Promise<void>

/** Owns the current window's IPC resources while earlier windows drain. */
export class WindowIpcLifecycle {
  private current: Disposer | null = null
  private readonly pending = new Set<Promise<void>>()

  install(dispose: Disposer) {
    if (this.current) throw new Error('A janela anterior ainda possui recursos IPC.')
    this.current = dispose
  }

  dispose(): Promise<void> {
    const dispose = this.current
    // Detach before invoking or awaiting anything: activate may install the
    // next window while the previous asynchronous cleanup is still running.
    this.current = null
    const operation = dispose ? (async () => { await dispose() })() : undefined
    if (operation) this.pending.add(operation)
    return Promise.allSettled([...this.pending]).then((results) => {
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length) throw Object.assign(new Error('Window IPC cleanup failed.'), { failures })
    }).finally(() => {
      if (operation) this.pending.delete(operation)
    })
  }
}
