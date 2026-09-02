import { spawn, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { buildCodexEnvironment } from '../codex/CodexProcess'
import { CODE_INTELLIGENCE_LIMITS } from '../../shared/constants'

export interface ProcessRunOptions {
  cwd: string
  signal: AbortSignal
  timeoutMs?: number
  maxOutputCharacters?: number
}

export interface ProcessRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  cancelled: boolean
  timedOut: boolean
  truncated: boolean
  error: string | null
}

export interface ProcessRunner {
  run(command: string, args: string[], options: ProcessRunOptions): Promise<ProcessRunResult>
}

/** Runs validation commands without a shell and with bounded, cancellable output. */
export class CancellableProcessRunner implements ProcessRunner {
  async run(command: string, args: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    const started = performance.now()
    const maxOutputCharacters = options.maxOutputCharacters ?? CODE_INTELLIGENCE_LIMITS.maxOutputCharacters
    if (options.signal.aborted) return result(null, '', '', started, true, false, false, null)

    return new Promise<ProcessRunResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let truncated = false
      let cancelled = false
      let timedOut = false
      let processError: string | null = null
      let killTimer: NodeJS.Timeout | undefined
      let timeoutTimer: NodeJS.Timeout | undefined
      let settled = false
      let child: ChildProcess | null = null

      const append = (current: string, chunk: string) => {
        if (current.length >= maxOutputCharacters) {
          truncated = true
          return current
        }
        const next = current + chunk
        if (next.length > maxOutputCharacters) truncated = true
        return next.slice(0, maxOutputCharacters)
      }

      const terminate = (reason: 'cancelled' | 'timeout') => {
        if (reason === 'cancelled') cancelled = true
        else timedOut = true
        if (!child) return
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGTERM') } catch { /* the close event still settles the run */ }
          killTimer = setTimeout(() => {
            if (!settled && child && child.exitCode === null && child.signalCode === null) {
              try { child.kill('SIGKILL') } catch { /* process may have exited */ }
            }
          }, 3_000)
          killTimer.unref()
        }
      }

      const finish = (exitCode: number | null) => {
        if (settled) return
        settled = true
        if (killTimer) clearTimeout(killTimer)
        if (timeoutTimer) clearTimeout(timeoutTimer)
        options.signal.removeEventListener('abort', onAbort)
        resolve(result(exitCode, stdout, stderr, started, cancelled, timedOut, truncated, processError))
      }

      const onAbort = () => terminate('cancelled')
      options.signal.addEventListener('abort', onAbort, { once: true })
      if (options.signal.aborted) {
        cancelled = true
        finish(null)
        return
      }

      try {
        child = spawn(command, args, {
          cwd: options.cwd,
          env: buildCodexEnvironment(),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        processError = error instanceof Error ? error.message : String(error)
        finish(null)
        return
      }

      if (cancelled || options.signal.aborted) terminate('cancelled')

      child.stdout?.on('data', (chunk: Buffer | string) => { stdout = append(stdout, chunk.toString()) })
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr = append(stderr, chunk.toString()) })
      child.once('error', (error) => { processError = error.message })
      child.once('close', (exitCode) => finish(exitCode))
      const timeoutMs = options.timeoutMs ?? 120_000
      if (!settled) {
        timeoutTimer = setTimeout(() => terminate('timeout'), timeoutMs)
        timeoutTimer.unref()
      }
    })
  }
}

function result(
  exitCode: number | null,
  stdout: string,
  stderr: string,
  started: number,
  cancelled: boolean,
  timedOut: boolean,
  truncated: boolean,
  error: string | null,
): ProcessRunResult {
  return {
    exitCode,
    stdout,
    stderr,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    cancelled,
    timedOut,
    truncated,
    error,
  }
}
