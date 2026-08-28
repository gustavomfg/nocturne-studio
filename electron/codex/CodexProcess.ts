import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { RpcMessage } from './protocol'
import { parseRpcLine } from './RpcTransport'

const CODEX_ENVIRONMENT_ALLOWLIST = new Set([
  'PATH',
  'SHELL',
  'COMSPEC',
  'SYSTEMROOT',
  'WINDIR',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
])

const CODEX_ENVIRONMENT_DENYLIST = new Set([
  'OPENAI_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'NODE_OPTIONS',
  'NODE_DEBUG',
  'NODE_EXTRA_CA_CERTS',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_ENABLE_LOGGING',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'SSH_ASKPASS',
  'GIT_ASKPASS',
  'GIT_SSH_COMMAND',
])

const SENSITIVE_ENVIRONMENT_KEY = /(?:^|_)(?:API_?KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIALS?)(?:_|$)/i

export function buildCodexEnvironment(source: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  const environment = {} as NodeJS.ProcessEnv
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const normalizedKey = key.toUpperCase()
    if (!CODEX_ENVIRONMENT_ALLOWLIST.has(normalizedKey)) continue
    if (CODEX_ENVIRONMENT_DENYLIST.has(normalizedKey) || SENSITIVE_ENVIRONMENT_KEY.test(normalizedKey)) continue
    environment[key] = value
  }
  return environment
}

export class CodexProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private stopping = false
  private executable = 'codex'

  start(executable = this.executable) {
    if (this.child) return
    this.executable = executable
    this.stopping = false
    this.child = spawn(executable, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildCodexEnvironment(),
    })

    const child = this.child
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      const message = parseRpcLine(line)
      if (message) this.emit('message', message)
      else this.emit('stdout', line)
    })
    child.stderr.on('data', (chunk) => this.emit('stderr', chunk.toString().slice(-64_000)))
    child.stdin.on('error', (error) => this.emit('error', error))
    child.on('error', (error) => this.emit('error', error))
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null
      lines.close()
      this.emit('exit', code, signal, this.stopping)
      this.stopping = false
    })
    child.on('close', (code, signal) => this.emit('close', code, signal))
  }

  send(message: RpcMessage) {
    if (!this.child?.stdin.writable) throw new Error('Codex App Server não está disponível.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  stop() {
    if (!this.child) return
    this.stopping = true
    this.child.kill('SIGTERM')
    const child = this.child
    setTimeout(() => {
      if (this.child === child) child.kill('SIGKILL')
    }, 3_000).unref()
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed)
  }

  get pid() {
    return this.child?.pid ?? null
  }

  get path() {
    return this.executable
  }
}
