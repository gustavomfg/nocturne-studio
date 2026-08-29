import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { performance } from 'node:perf_hooks'
import { isMainProcessOperational } from '../runtime/MainProcessState'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

export interface SafeIpcMain {
  handle(channel: string, handler: Handler): void
  dispose(): void
}

export interface IpcTimingRecord {
  channel: string
  durationMs: number
  failed: boolean
}

export interface SafeIpcMainOptions {
  onCompleted?(record: IpcTimingRecord): void
}

interface RateLimitConfig {
  windowMs: number
  maxCalls: number
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  default: { windowMs: 1_000, maxCalls: 120 },
  'ai:send': { windowMs: 10_000, maxCalls: 5 },
  'ai:cancel': { windowMs: 2_000, maxCalls: 10 },
  'ai:approve': { windowMs: 2_000, maxCalls: 20 },
  'ai:rollback': { windowMs: 10_000, maxCalls: 3 },
  'codex:accountStatus': { windowMs: 5_000, maxCalls: 10 },
  'codex:models': { windowMs: 5_000, maxCalls: 5 },
  'codex:login': { windowMs: 60_000, maxCalls: 2 },
  'codex:logout': { windowMs: 10_000, maxCalls: 2 },
  'git:commit': { windowMs: 5_000, maxCalls: 5 },
  'data:import': { windowMs: 30_000, maxCalls: 2 },
  'data:export': { windowMs: 30_000, maxCalls: 5 },
  'providers:create': { windowMs: 10_000, maxCalls: 5 },
  'providers:update': { windowMs: 10_000, maxCalls: 10 },
  'clipboard:readText': { windowMs: 1_000, maxCalls: 10 },
}

export function safeIpcMain(win: BrowserWindow, options: SafeIpcMainOptions = {}): SafeIpcMain {
  const channels = new Set<string>()
  const callLog = new Map<string, number[]>()
  let disposed = false
  const report = (channel: string, startedAt: number, failed: boolean) => {
    try {
      options.onCompleted?.({ channel, durationMs: Math.max(0, Math.round(performance.now() - startedAt)), failed })
    } catch {
      // Observability must never change the IPC operation's behavior.
    }
  }
  const invoke = (channel: string, handler: Handler, event: IpcMainInvokeEvent, args: unknown[]) => {
    const startedAt = performance.now()
    const finish = (failed: boolean) => report(channel, startedAt, failed)
    try {
      const result = handler(event, ...args)
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        return Promise.resolve(result).then(
          (value) => { finish(false); return value },
          (error: unknown) => { finish(true); throw error },
        )
      }
      finish(false)
      return result
    } catch (error) {
      finish(true)
      throw error
    }
  }
  return {
    handle(channel: string, handler: Handler) {
      if (disposed) throw new Error('O registro de handlers IPC já foi descartado.')
      if (channels.has(channel)) throw new Error(`Handler IPC duplicado: ${channel}.`)
      ipcMain.handle(channel, (event, ...args) => invoke(channel, (trustedEvent, ...trustedArgs) => {
        if (!isMainProcessOperational()) throw new Error('O processo principal está encerrando após uma falha fatal.')
        const trustedContents = win.webContents
        const expectedUrl = trustedContents.getURL()
        if (trustedEvent.sender !== trustedContents || trustedEvent.senderFrame !== trustedContents.mainFrame || !expectedUrl || trustedEvent.senderFrame.url !== expectedUrl) {
          throw new Error(`Origem IPC não autorizada para ${channel}.`)
        }
        const config = RATE_LIMITS[channel] ?? RATE_LIMITS.default
        const now = Date.now()
        const windowStart = now - config.windowMs
        let timestamps = callLog.get(channel)
        if (!timestamps) {
          timestamps = []
          callLog.set(channel, timestamps)
        }
        while (timestamps.length > 0 && timestamps[0] < windowStart) timestamps.shift()
        if (timestamps.length >= config.maxCalls) {
          throw new Error(`Limite de taxa excedido para ${channel}. Tente novamente em alguns instantes.`)
        }
        timestamps.push(now)
        return handler(trustedEvent, ...trustedArgs)
      }, event, args))
      channels.add(channel)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const channel of channels) ipcMain.removeHandler(channel)
      channels.clear()
      callLog.clear()
    },
  }
}
