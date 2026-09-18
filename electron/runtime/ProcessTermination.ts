import type { ChildProcess } from 'node:child_process'

export type ProcessTerminationScope = 'process-group' | 'parent-only'

/**
 * Terminates the process group created by Nocturne on POSIX. Windows does not
 * offer an equivalent Node primitive, so callers must record that only the
 * direct child was targeted there instead of claiming tree termination.
 */
export function terminateProcess(child: Pick<ChildProcess, 'pid' | 'kill'>, signal: NodeJS.Signals): ProcessTerminationScope {
  if (process.platform !== 'win32' && child.pid && child.pid > 0) {
    try {
      process.kill(-child.pid, signal)
      return 'process-group'
    } catch {
      // The group may already have exited or may not be available on this OS.
    }
  }
  try { child.kill(signal) } catch { /* the close event or timeout settles the caller */ }
  return 'parent-only'
}

export function usesDedicatedProcessGroup() {
  return process.platform !== 'win32'
}
