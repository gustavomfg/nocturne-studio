import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { isMainProcessOperational } from '../runtime/MainProcessState'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

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

export function safeIpcMain(win: BrowserWindow) {
  const channels = new Set<string>()
  const callLog = new Map<string, number[]>()
  let disposed = false
  return {
    handle(channel: string, handler: Handler) {
      if (disposed) throw new Error('O registro de handlers IPC já foi descartado.')
      if (channels.has(channel)) throw new Error(`Handler IPC duplicado: ${channel}.`)
      ipcMain.handle(channel, (event, ...args) => {
        if (!isMainProcessOperational()) throw new Error('O processo principal está encerrando após uma falha fatal.')
        const trustedContents = win.webContents
        const expectedUrl = trustedContents.getURL()
        if (event.sender !== trustedContents || event.senderFrame !== trustedContents.mainFrame || !expectedUrl || event.senderFrame.url !== expectedUrl) {
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
        return handler(event, ...args)
      })
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
