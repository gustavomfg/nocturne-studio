import fs from 'node:fs'
import path from 'node:path'
import type { WorkspaceChangeEvent } from '../../shared/types'

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'release', 'out', 'coverage'])
const MAX_CHANGED_PATHS = 100

interface WatchHandle {
  close(): void
  on(event: 'error', listener: (error: Error) => void): this
}

// Node does not expose a cross-platform ready event for fs.FSWatcher. Let the
// native backend finish registration before resolving the IPC watch request.
function waitForNativeWatcherRegistration() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

type WatchFactory = (
  workspace: string,
  options: { recursive: true; persistent: false; encoding: 'utf8' },
  listener: (eventType: string, filename: string | null) => void,
) => WatchHandle

export class WorkspaceChangeWatcher {
  private watcher: WatchHandle | null = null
  private workspace = ''
  private readiness: Promise<void> | null = null
  private changedPaths = new Set<string>()
  private overflow = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly emit: (event: WorkspaceChangeEvent) => void,
    private readonly watchFactory: WatchFactory = (workspace, options, listener) => fs.watch(workspace, options, listener),
    private readonly debounceMs = 250,
  ) {}

  async start(workspace: string): Promise<void> {
    if (this.workspace === workspace && this.watcher) {
      await (this.readiness ?? Promise.resolve())
      return
    }
    this.stop()
    this.workspace = workspace
    try {
      this.watcher = this.watchFactory(workspace, { recursive: true, persistent: false, encoding: 'utf8' }, (_eventType, filename) => {
        this.queue(filename)
      })
      this.watcher.on('error', (error) => {
        this.emit({ workspace: this.workspace, paths: [], overflow: false, detectedAt: new Date().toISOString(), error: `Monitoramento interrompido: ${error.message}` })
        this.stop()
      })
      this.readiness = waitForNativeWatcherRegistration()
      await this.readiness
    } catch (error) {
      this.workspace = ''
      this.readiness = null
      throw new Error(`Não foi possível monitorar alterações no workspace: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  stop() {
    this.watcher?.close()
    this.watcher = null
    this.workspace = ''
    this.readiness = null
    this.changedPaths.clear()
    this.overflow = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private queue(filename: string | null) {
    if (!filename) {
      this.overflow = true
    } else {
      const relative = filename.replace(/\\/g, '/').replace(/^\/+/, '')
      const firstSegment = relative.split('/')[0]
      if (!relative || IGNORED_DIRECTORIES.has(firstSegment)) return
      const resolved = path.resolve(this.workspace, relative)
      const root = `${path.resolve(this.workspace)}${path.sep}`
      if (!resolved.startsWith(root)) return
      if (this.changedPaths.size < MAX_CHANGED_PATHS) this.changedPaths.add(relative)
      else this.overflow = true
    }
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  private flush() {
    this.timer = null
    if (!this.workspace || (!this.changedPaths.size && !this.overflow)) return
    this.emit({
      workspace: this.workspace,
      paths: [...this.changedPaths].sort(),
      overflow: this.overflow,
      detectedAt: new Date().toISOString(),
    })
    this.changedPaths.clear()
    this.overflow = false
  }
}
