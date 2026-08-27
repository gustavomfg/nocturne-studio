import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { RpcMessage } from './protocol'
import { parseRpcLine } from './RpcTransport'

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
      env: process.env,
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
