import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type BoundaryOutcome = 'CONFLICT' | 'REVOKED' | 'UNSUPPORTED' | 'UNKNOWN'
export class NativeBoundaryError extends Error {
  constructor(readonly outcome: BoundaryOutcome, message: string) { super(`${outcome}: ${message}`) }
}

const MAX_FRAME = 32 * 1024 * 1024 * 2 + 16384
const activeOperations = new Set<NativeRollbackOperation>()
const encode = (value: string | Buffer) => Buffer.from(value).toString('hex')

export function nativeRollbackWorkerPath() {
  const name = process.platform === 'win32' ? 'rollback-boundary.exe' : 'rollback-boundary'
  if (import.meta.url.includes('.asar/')) return path.join(process.resourcesPath, 'native-boundary', name)
  const directory = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(directory, path.basename(directory) === 'dist-electron' ? '..' : '../..', 'dist-native', name)
}

export function protectedRollbackSupported() { return process.platform === 'linux' }

/** Read-only root custody spanning async preparation or several file decisions. */
export async function withRollbackRootBinding<T>(workspace: string, expectedIdentity: string | undefined, action: (identity: string | undefined) => Promise<T>): Promise<T> {
  if (!protectedRollbackSupported()) return action(undefined)
  const root = await fs.promises.open(workspace, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
  try {
    const metadata = await root.stat({ bigint: true })
    const identity = `${metadata.dev}:${metadata.ino}`
    if (expectedIdentity && identity !== expectedIdentity) throw new NativeBoundaryError('REVOKED', 'Workspace root changed during preparation.')
    return await action(identity)
  } finally { await root.close() }
}

/** One trusted main-process owner, one native worker, short-lived capabilities. */
export class NativeRollbackOperation {
  private state: 'ACTIVE' | 'REVOKED' | 'CLOSED' = 'ACTIVE'
  private readonly child: ChildProcessWithoutNullStreams
  private buffered = ''
  private pending?: { resolve(value: string[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

  private constructor(readonly rootIdentity: string, readonly recoveryIdentity: string) {
    this.child = spawn(nativeRollbackWorkerPath(), [], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { NODE_ENV: 'production', VITE_DEV_SERVER_URL: '', APP_ROOT: '', VITE_PUBLIC: '', LANG: 'C.UTF-8', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) },
    })
    activeOperations.add(this)
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffered += chunk
      if (this.buffered.length > MAX_FRAME) return this.fail(new NativeBoundaryError('UNKNOWN', 'Native response exceeded budget.'))
      if (!chunk.includes('\n')) return
      const newline = this.buffered.indexOf('\n')
      if (newline < 0) return
      const fields = this.buffered.slice(0, newline).trimEnd().split('\t')
      this.buffered = this.buffered.slice(newline + 1)
      const pending = this.pending
      if (!pending) return this.fail(new NativeBoundaryError('UNKNOWN', 'Unexpected native response.'))
      this.pending = undefined
      clearTimeout(pending.timer)
      if (fields[0] === 'ERR') {
        this.state = 'REVOKED'
        const outcome = ['CONFLICT', 'REVOKED', 'UNSUPPORTED', 'UNKNOWN'].includes(fields[1]) ? fields[1] as BoundaryOutcome : 'UNKNOWN'
        pending.reject(new NativeBoundaryError(outcome, Buffer.from(fields[2] ?? '', 'hex').toString('utf8')))
      } else pending.resolve(fields)
    })
    this.child.stderr.resume()
    this.child.stdin.on('error', () => this.fail(new NativeBoundaryError('UNKNOWN', 'Native input interrupted.')))
    this.child.on('error', (error: NodeJS.ErrnoException) => this.fail(new NativeBoundaryError(error.code === 'ENOENT' ? 'UNSUPPORTED' : 'UNKNOWN', 'Native rollback worker unavailable.')))
    this.child.on('exit', () => {
      if (this.state !== 'CLOSED') this.fail(new NativeBoundaryError('UNKNOWN', 'Native worker exited before confirmation.'))
      activeOperations.delete(this)
    })
  }

  static async create(workspace: string, recoveryDirectory: string, expectedRootIdentity?: string) {
    return withRollbackRootBinding(workspace, expectedRootIdentity, (rootIdentity) =>
      withRollbackRootBinding(recoveryDirectory, undefined, async (recoveryIdentity) => {
        const operation = new NativeRollbackOperation(rootIdentity ?? '', recoveryIdentity ?? '')
        try {
          await operation.request('INIT', encode(workspace), encode(operation.rootIdentity), encode(recoveryDirectory), encode(operation.recoveryIdentity))
          return operation
        } catch (error) { await operation.close(); throw error }
      }),
    )
  }

  async inspect(relativePath: string) {
    const response = await this.request('OPEN', encode(relativePath.replace(/\\/g, '/')))
    if (response[0] !== 'DATA') throw new NativeBoundaryError('UNKNOWN', 'Invalid native observation.')
    const exists = response[1] === '1'
    return { exists, mode: exists ? Number(response[2]) : null, identity: Buffer.from(response[3] ?? '', 'hex').toString(), parentIdentity: Buffer.from(response[5] ?? '', 'hex').toString(), content: Buffer.from(response[4] ?? '', 'hex') }
  }

  async stage(content: Buffer, mode: number) {
    const response = await this.request('STAGE', encode(content), String(mode & 0o7777))
    if (response[0] !== 'STAGED') throw new NativeBoundaryError('UNKNOWN', 'Invalid native stage confirmation.')
    return { identity: Buffer.from(response[1] ?? '', 'hex').toString() }
  }
  async next() { return this.request('NEXT') }
  async displace(retentionEntry: string) { return this.request('DISPLACE', encode(retentionEntry)) }
  async publish() { return this.request('PUBLISH') }
  async journal(record: unknown, entry: unknown = record) { return this.request('JOURNAL', encode(JSON.stringify(record)), encode(JSON.stringify(entry))) }
  async revoke() {
    if (this.state !== 'CLOSED') { this.state = 'REVOKED'; await this.request('REVOKE').catch(() => undefined) }
  }

  private request(command: string, ...fields: string[]): Promise<string[]> {
    if (this.state === 'CLOSED' || (this.state === 'REVOKED' && command !== 'JOURNAL' && command !== 'REVOKE')) return Promise.reject(new NativeBoundaryError('REVOKED', 'No new mutation after capability loss.'))
    if (fields.reduce((size, field) => size + field.length + 1, command.length) > MAX_FRAME) return Promise.reject(new NativeBoundaryError('UNSUPPORTED', 'Native request exceeded budget.'))
    if (this.pending) return Promise.reject(new NativeBoundaryError('CONFLICT', 'Native operations must be serialized.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new NativeBoundaryError('UNKNOWN', 'Native operation deadline exceeded.')), 15_000)
      this.pending = { resolve, reject, timer }
      this.child.stdin.write(`${[command, ...fields].join('\t')}\n`, (error) => { if (error) this.fail(new NativeBoundaryError('UNKNOWN', 'Native command delivery failed.')) })
    })
  }

  private fail(error: Error) {
    if (this.state === 'CLOSED') return
    this.state = 'REVOKED'
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined }
    this.child.kill('SIGKILL')
  }

  async close() {
    if (this.state === 'CLOSED') return
    this.state = 'CLOSED'
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new NativeBoundaryError('UNKNOWN', 'Operation disposed while unconfirmed.')); this.pending = undefined }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { this.child.kill('SIGKILL'); resolve() }, 1000)
        this.child.once('exit', () => { clearTimeout(timeout); resolve() })
        this.child.stdin.end('CLOSE\n')
      })
    }
    this.child.stdout.destroy(); this.child.stderr.destroy(); this.child.stdin.destroy()
    activeOperations.delete(this)
  }
}

export async function closeNativeRollbackOperations() {
  await Promise.all([...activeOperations].map((operation) => operation.close()))
}
