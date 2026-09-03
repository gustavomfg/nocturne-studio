import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isIgnoredProjectDiscoveryRelativePath } from '../workspaces/WorkspacePathPolicy'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'
import type { CheckpointFileRecord } from '../../shared/changeControl'

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024

interface FileCandidate {
  relativePath: string
}

interface FileIdentity {
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

/** Captures recoverable workspace bytes outside the project directory. */
export class WorkspaceCheckpointStore {
  constructor(private readonly rootDirectory: string) {}

  async capture(workspace: string, checkpointId: string, requestedPaths?: readonly string[]): Promise<CheckpointFileRecord[]> {
    const root = path.resolve(workspace)
    const candidates = await this.collectCandidates(root, requestedPaths)
    const checkpointDirectory = path.join(this.rootDirectory, checkpointId)
    await fs.promises.mkdir(checkpointDirectory, { recursive: true, mode: 0o700 })
    const records: CheckpointFileRecord[] = []
    let totalBytes = 0
    try {
      for (const candidate of candidates) {
        const record = await this.captureCandidate(candidate, workspace, checkpointId, checkpointDirectory, totalBytes)
        totalBytes += record.size ?? 0
        records.push(record)
      }
      return records
    } catch (error) {
      await fs.promises.rm(checkpointDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async readContent(file: CheckpointFileRecord): Promise<Buffer> {
    if (!file.contentPath) throw new Error(`O checkpoint não contém o conteúdo de ${file.relativePath}.`)
    return fs.promises.readFile(file.contentPath)
  }

  async remove(checkpointId: string) {
    await fs.promises.rm(path.join(this.rootDirectory, checkpointId), { recursive: true, force: true })
  }

  pathFor(checkpointId: string) {
    return path.join(this.rootDirectory, checkpointId)
  }

  private async captureCandidate(candidate: FileCandidate, workspace: string, checkpointId: string, checkpointDirectory: string, totalBytes: number): Promise<CheckpointFileRecord> {
    const resolved = resolveInsideWorkspace(candidate.relativePath, workspace)
    const stat = await fs.promises.lstat(resolved).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!stat) {
      return {
        id: randomUUID(), checkpointId, relativePath: candidate.relativePath, exists: false,
        kind: 'missing', size: null, mode: null, hash: null, contentPath: null,
      }
    }
    if (!stat.isFile()) {
      return {
        id: randomUUID(), checkpointId, relativePath: candidate.relativePath, exists: true,
        kind: stat.isDirectory() ? 'directory' : 'symlink', size: stat.size, mode: stat.mode,
        hash: null, contentPath: null,
      }
    }
    if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
      throw new Error(`O checkpoint excederia o limite seguro ao capturar ${candidate.relativePath}.`)
    }
    const identity = toIdentity(stat)
    const content = await fs.promises.readFile(resolved)
    const after = await fs.promises.stat(resolved)
    if (!sameIdentity(identity, toIdentity(after))) throw new Error(`O arquivo mudou durante a captura do checkpoint: ${candidate.relativePath}.`)
    const hash = createHash('sha256').update(content).digest('hex')
    const contentPath = path.join(checkpointDirectory, `${hash}-${randomUUID()}.bin`)
    await writeAtomicBytes(contentPath, content)
    return {
      id: randomUUID(), checkpointId, relativePath: candidate.relativePath, exists: true,
      kind: 'file', size: content.length, mode: stat.mode, hash, contentPath,
    }
  }

  private async collectCandidates(workspace: string, requestedPaths?: readonly string[]): Promise<FileCandidate[]> {
    const candidates: FileCandidate[] = []
    const visited = new Set<string>()
    const visit = async (relativePath: string): Promise<void> => {
      if (visited.has(relativePath)) return
      visited.add(relativePath)
      const absolute = resolveInsideWorkspace(relativePath || '.', workspace)
      const stat = await fs.promises.lstat(absolute).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (!stat) {
        candidates.push({ relativePath })
        return
      }
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const entries = await fs.promises.readdir(absolute, { withFileTypes: true })
        for (const entry of entries) {
          const child = relativePath ? `${relativePath}/${entry.name}` : entry.name
          if (!isIgnoredProjectDiscoveryRelativePath(child)) await visit(child)
        }
        return
      }
      candidates.push({ relativePath })
    }
    if (requestedPaths?.length) {
      for (const requested of requestedPaths) {
        const normalized = requested.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
        if (normalized && !isIgnoredProjectDiscoveryRelativePath(normalized)) await visit(normalized)
      }
    } else {
      await visit('')
    }
    return candidates.filter((candidate) => candidate.relativePath).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }
}

function toIdentity(stat: fs.Stats): FileIdentity {
  return { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino }
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && (!left.ino || !right.ino || (left.ino === right.ino && left.dev === right.dev))
}

async function writeAtomicBytes(filePath: string, content: Buffer) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  let handle: fs.promises.FileHandle | undefined
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.promises.chmod(temporary, 0o600)
    await fs.promises.rename(temporary, filePath)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.promises.unlink(temporary).catch(() => undefined)
    throw error
  }
}
