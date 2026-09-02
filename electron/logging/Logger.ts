import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'app' | 'codex' | 'ai' | 'ipc' | 'workspace' | 'index' | 'validation' | 'git' | 'artifacts' | 'export' | 'persistence' | 'update'

export class Logger {
  private readonly file: string
  private readonly sessionId = randomUUID()
  private readonly startedAt = new Date().toISOString()
  private readonly counters: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
  private writeFailures = 0
  private lastWriteFailureFingerprint: string | null = null
  private writes = Promise.resolve()
  constructor(private readonly directory: string, private diagnostic = false, private readonly maxBytes = 2_000_000) {
    fs.mkdirSync(directory, { recursive: true })
    this.file = path.join(directory, 'nocturne.log')
  }
  setDiagnostic(enabled: boolean) { this.diagnostic = enabled }
  debug(category: LogCategory, message: string, data?: unknown) { if (this.diagnostic) this.write('debug', category, message, data) }
  info(category: LogCategory, message: string, data?: unknown) { this.write('info', category, message, data) }
  warn(category: LogCategory, message: string, data?: unknown) { this.write('warn', category, message, data) }
  error(category: LogCategory, message: string, error?: unknown) { this.write('error', category, message, serializeError(error)) }
  get path() { return this.directory }
  snapshot() {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      diagnosticMode: this.diagnostic,
      entries: { ...this.counters },
      writeFailures: this.writeFailures,
      ...(this.lastWriteFailureFingerprint ? { lastWriteFailureFingerprint: this.lastWriteFailureFingerprint } : {}),
    }
  }
  private write(level: LogLevel, category: LogCategory, message: string, data?: unknown) {
    this.counters[level] += 1
    const entry = { timestamp: new Date().toISOString(), sessionId: this.sessionId, level, category, message: redactLogText(message), data: redactLogValue(data) }
    this.writes = this.writes.then(async () => { await this.rotate(); await fs.promises.appendFile(this.file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 }) }).catch((error) => {
      this.writeFailures += 1
      this.lastWriteFailureFingerprint = diagnosticFingerprint(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
      console.error('Falha ao gravar log do Nocturne:', this.lastWriteFailureFingerprint)
    })
  }
  flush() { return this.writes }
  private async rotate() {
    try {
      if ((await fs.promises.stat(this.file)).size < this.maxBytes) return
      const backup = `${this.file}.1`
      await fs.promises.unlink(backup).catch(() => undefined)
      await fs.promises.rename(this.file, backup)
    } catch { /* file does not exist yet */ }
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, fingerprint: diagnosticFingerprint(`${error.message}\n${error.stack ?? ''}`) }
  if (typeof error === 'string') return { fingerprint: diagnosticFingerprint(error) }
  return error
}

const TOKEN_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/, // OpenAI / Anthropic
  /pk-[a-zA-Z0-9]{20,}/, // OpenAI Project Key
  /gh[opsu]_[a-zA-Z0-9]{36,}/, // GitHub
  /glpat-[a-zA-Z0-9_-]{20,}/, // GitLab
  /npm_[a-zA-Z0-9]{36,}/, // npm
  /AKIA[0-9A-Z]{16}/, // AWS Access Key
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/, // JWT
  /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PRIVATE)\s+KEY-----/, // SSH private key
]
const SENSITIVE_KEYS = new RegExp(`(?:${TOKEN_PATTERNS.map((p) => p.source).join('|')})`, 'g')
const SENSITIVE_FIELD_NAMES = /token|authorization|api[_-]?key|apikey|password|secret|credential|auth_token|refresh_token|access_token|client_secret|private_key|privatekey|prompt|content|diff|stdout|stderr|message|stack|error|line/i
const SENSITIVE_HEADER = /\b(bearer|basic|digest|token)\s+[a-zA-Z0-9+/=_-]{8,}/gi
const JSON_SENSITIVE = new RegExp(`(["'])(?:${SENSITIVE_FIELD_NAMES.source})["']\\s*:\\s*["'](.*?)["']`, 'gi')
const KEY_VALUE_SENSITIVE = new RegExp(`\\b(${SENSITIVE_FIELD_NAMES.source})(\\s*[=:]\\s*)(["'])([^"']+)\\3`, 'gi')

export function redactLogText(value: string) {
  const jsonRedacted = value.replace(JSON_SENSITIVE, (_match, quote) => `${quote}[REDACTED]${quote}`)
  const headerRedacted = jsonRedacted.replace(SENSITIVE_HEADER, '$1 [REDACTED]')
  const kvRedacted = headerRedacted.replace(KEY_VALUE_SENSITIVE, '$1$2[REDACTED]')
  const keyRedacted = kvRedacted.replace(SENSITIVE_KEYS, '[REDACTED-TOKEN]')
  return keyRedacted.slice(0, 8_000)
}
export function diagnosticFingerprint(value: string) { return createHash('sha256').update(value).digest('hex').slice(0, 16) }
export function redactLogValue(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>())
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactLogText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value
  if (depth >= 5) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1, seen))
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).filter(([key]) => !SENSITIVE_FIELD_NAMES.test(key)).map(([key, item]) => [key, redactValue(item, depth + 1, seen)]))
  }
  return value
}
