import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { WorkspaceChangeEvent } from '../../shared/types'

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'release', 'out', 'coverage'])
const MAX_CHANGED_PATHS = 100

interface WatchHandle {
  close(): void | Promise<void>
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'ready', listener: () => void): this
  on(event: 'all', listener: (eventType: string, filename: string) => void): this
}

type WatchFactory = (
  workspace: string,
  listener: (eventType: string, filename: string | null) => void,
) => WatchHandle

type WorkspaceSnapshot = Map<string, string>
type SnapshotFactory = (workspace: string) => Promise<WorkspaceSnapshot>

function relativeWorkspacePath(workspace: string, candidate: string) {
  const root = path.resolve(workspace)
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate)
  const relative = path.relative(root, resolved).replace(/\\/g, '/')
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return null
  return relative
}

function isIgnoredPath(workspace: string, candidate: string) {
  const relative = relativeWorkspacePath(workspace, candidate)
  return relative ? IGNORED_DIRECTORIES.has(relative.split('/')[0]) : false
}

async function captureWorkspaceSnapshot(workspace: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map()
  const root = path.resolve(workspace)

  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (IGNORED_DIRECTORIES.has(relative.split('/')[0])) continue
      const absolute = path.join(directory, entry.name)
      let stat: fs.Stats
      try {
        stat = await fs.promises.lstat(absolute)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const kind = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file'
      snapshot.set(relative, `${kind}:${stat.size}:${stat.mtimeMs}:${stat.mode}`)
      if (stat.isDirectory() && !stat.isSymbolicLink()) await visit(absolute, relative)
    }
  }

  await visit(root, '')
  return snapshot
}

function reconcileSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  const changed = new Set<string>()
  for (const [relative, signature] of before) {
    if (after.get(relative) !== signature) changed.add(relative)
  }
  for (const relative of after.keys()) {
    if (!before.has(relative)) changed.add(relative)
  }
  return [...changed].sort()
}

function createWatchHandle(workspace: string, listener: (eventType: string, filename: string | null) => void): WatchHandle {
  const watcher: FSWatcher = chokidar.watch(workspace, {
    atomic: true,
    followSymlinks: false,
    ignoreInitial: true,
    ignored: (candidate) => isIgnoredPath(workspace, candidate),
    persistent: false,
    usePolling: false,
  })
  watcher.on('all', (eventType, filename) => listener(eventType, filename))
  return watcher
}

export class WorkspaceChangeWatcher {
  private watcher: WatchHandle | null = null
  private workspace = ''
  private readiness: Promise<void> | null = null
  private rejectReadiness: ((reason?: unknown) => void) | null = null
  private changedPaths = new Set<string>()
  private overflow = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly emit: (event: WorkspaceChangeEvent) => void,
    private readonly watchFactory: WatchFactory = createWatchHandle,
    private readonly debounceMs = 250,
    private readonly snapshotFactory: SnapshotFactory = captureWorkspaceSnapshot,
  ) {}

  async start(workspace: string): Promise<void> {
    if (this.workspace === workspace && this.watcher) {
      await (this.readiness ?? Promise.resolve())
      return
    }
    await this.stop()
    this.workspace = workspace
    try {
      const beforeWatch = await this.snapshotFactory(workspace)
      this.watcher = this.watchFactory(workspace, (_eventType, filename) => {
        this.queue(filename)
      })
      this.watcher.on('error', (error) => {
        this.emit({ workspace: this.workspace, paths: [], overflow: false, detectedAt: new Date().toISOString(), error: `Monitoramento interrompido: ${error.message}` })
        this.rejectReadiness?.(error)
        void this.stop()
      })
      this.readiness = new Promise<void>((resolve, reject) => {
        this.rejectReadiness = reject
        this.watcher?.on('ready', () => {
          this.rejectReadiness = null
          resolve()
        })
      })
      await this.readiness
      const afterWatch = await this.snapshotFactory(workspace)
      for (const relative of reconcileSnapshots(beforeWatch, afterWatch)) this.queue(relative)
    } catch (error) {
      this.rejectReadiness = null
      await this.stop()
      throw new Error(`Não foi possível monitorar alterações no workspace: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async stop(): Promise<void> {
    this.rejectReadiness?.(new Error('Monitoramento do workspace encerrado.'))
    this.rejectReadiness = null
    const watcher = this.watcher
    this.watcher = null
    if (watcher) {
      const closing = watcher.close()
      if (closing && typeof closing.then === 'function') await closing.catch(() => undefined)
    }
    this.workspace = ''
    this.readiness = null
    this.changedPaths.clear()
    this.overflow = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private queue(filename: string | null) {
    if (!this.workspace) return
    if (!filename) {
      this.overflow = true
    } else {
      const relative = relativeWorkspacePath(this.workspace, filename)
      if (!relative || IGNORED_DIRECTORIES.has(relative.split('/')[0])) return
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
