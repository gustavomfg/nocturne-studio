import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { RpcMessage } from './protocol'
import { parseRpcLine } from './RpcTransport'
import { isProcessGroupAlive, terminateProcess, usesDedicatedProcessGroup } from '../runtime/ProcessTermination'

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
  private readonly owned = new Map<ChildProcessWithoutNullStreams, { intentional: boolean; stop(): Promise<void> }>()
  private executable = 'codex'

  start(executable = this.executable) {
    if (this.child) return
    this.executable = executable
    this.child = spawn(executable, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildCodexEnvironment(),
      detached: usesDedicatedProcessGroup(),
    })

    const child = this.child
    const lines = readline.createInterface({ input: child.stdout })
    let cleanup: Promise<void> | undefined
    let parentExited = false
    let finishCleanup: (() => void) | undefined
    const record = { intentional: false, stop: () => {
      if (cleanup) return cleanup
      cleanup = new Promise<void>((resolve) => {
        let settled = false
        let escalation: NodeJS.Timeout | undefined
        let deadline: NodeJS.Timeout | undefined
        const finish = () => {
          if (settled) return
          settled = true
          if (escalation) clearTimeout(escalation)
          if (deadline) clearTimeout(deadline)
          lines.close()
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
          child.unref()
          this.owned.delete(child)
          // Group disappearance is not proof about descendants that escaped it.
          this.emit('termination', { pid: child.pid, scope: usesDedicatedProcessGroup() ? 'process-group' : 'parent-only', terminationUncertain: true })
          resolve()
        }
        finishCleanup = () => {
          if (parentExited && !isProcessGroupAlive(child.pid)) finish()
        }
        terminateProcess(child, 'SIGTERM')
        escalation = setTimeout(() => {
          // The parent exiting must not cancel escalation of its owned group.
          if (isProcessGroupAlive(child.pid) || !parentExited) terminateProcess(child, 'SIGKILL')
        }, 3_000)
        deadline = setTimeout(finish, 4_000)
        finishCleanup()
      })
      return cleanup
    } }
    this.owned.set(child, record)
    lines.on('line', (line) => {
      if (this.child !== child) return
      const message = parseRpcLine(line)
      if (message) this.emit('message', message)
      else this.emit('stdout', line)
    })
    child.stderr.on('data', (chunk) => { if (this.child === child) this.emit('stderr', chunk.toString().slice(-64_000)) })
    child.stdin.on('error', (error) => { if (this.child === child && !record.intentional) this.emit('error', error) })
    child.on('error', (error) => {
      if (this.child === child) this.emit('error', error)
      if (!child.pid) { parentExited = true; if (this.child === child) this.child = null; void record.stop() }
    })
    child.on('exit', (code, signal) => {
      parentExited = true
      if (this.child === child) this.child = null
      lines.close()
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
      this.emit('exit', code, signal, record.intentional)
      void record.stop()
      finishCleanup?.()
    })
    child.on('close', (code, signal) => this.emit('close', code, signal))
  }

  send(message: RpcMessage) {
    if (!this.child?.stdin.writable) throw new Error('Codex App Server não está disponível.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  stop() {
    return Promise.all([...this.owned.values()].map((record) => {
      record.intentional = true
      return record.stop()
    })).then(() => undefined)
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null)
  }

  get pid() {
    return this.child?.pid ?? null
  }

  get path() {
    return this.executable
  }
}
