import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CheckpointFileRecord } from '../../shared/changeControl'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'
import type { CheckpointService } from './CheckpointService'

export interface SnapshotRollbackResult {
  status: 'restored' | 'conflicted'
  restored: string[]
  conflicts: string[]
}

interface CurrentState {
  exists: boolean
  kind: CheckpointFileRecord['kind']
  size: number | null
  hash: string | null
}

/** Restores a checkpoint only when every target still matches the expected AFTER state. */
export class SnapshotRollbackService {
  constructor(private readonly checkpoints: CheckpointService) {}

  async rollback(executionId: string, workspace: string, beforeId: string, afterId: string): Promise<SnapshotRollbackResult> {
    const before = this.checkpoints.get(beforeId, executionId)
    const after = this.checkpoints.get(afterId, executionId)
    if (!before || !after || before.status !== 'ready' || after.status !== 'ready') throw new Error('Os checkpoints necessários para o rollback não estão disponíveis.')
    if (before.workspace !== workspace || after.workspace !== workspace) throw new Error('O rollback não corresponde ao workspace autorizado.')
    const beforeFiles = new Map(this.checkpoints.listFiles(before.id).map((file) => [file.relativePath, file]))
    const afterFiles = new Map(this.checkpoints.listFiles(after.id).map((file) => [file.relativePath, file]))
    const paths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()
    const conflicts: string[] = []
    const restorations: Array<{ relativePath: string; before: CheckpointFileRecord; after: CheckpointFileRecord }> = []
    for (const relativePath of paths) {
      const original = beforeFiles.get(relativePath) ?? missingFile(before.id, relativePath)
      const expected = afterFiles.get(relativePath) ?? missingFile(after.id, relativePath)
      if (sameState(original, expected)) continue
      const current = await inspectCurrent(workspace, relativePath)
      if (!sameState(current, expected)) conflicts.push(relativePath)
      else restorations.push({ relativePath, before: original, after: expected })
    }
    if (conflicts.length) return { status: 'conflicted', restored: [], conflicts }

    const restored: string[] = []
    for (const restoration of restorations) {
      await restoreFile(workspace, restoration.relativePath, restoration.before, this.checkpoints)
      restored.push(restoration.relativePath)
    }
    return { status: 'restored', restored, conflicts: [] }
  }
}

function missingFile(checkpointId: string, relativePath: string): CheckpointFileRecord {
  return { id: `missing-${checkpointId}-${relativePath}`, checkpointId, relativePath, exists: false, kind: 'missing', size: null, mode: null, hash: null, contentPath: null }
}

function sameState(left: CheckpointFileRecord | CurrentState, right: CheckpointFileRecord | CurrentState) {
  return left.exists === right.exists && left.kind === right.kind && left.size === right.size && left.hash === right.hash
}

async function inspectCurrent(workspace: string, relativePath: string): Promise<CurrentState> {
  const resolved = resolveInsideWorkspace(relativePath, workspace)
  const stat = await fs.promises.lstat(resolved).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!stat) return { exists: false, kind: 'missing', size: null, hash: null }
  if (!stat.isFile()) return { exists: true, kind: stat.isDirectory() ? 'directory' : 'symlink', size: stat.size, hash: null }
  const content = await fs.promises.readFile(resolved)
  return { exists: true, kind: 'file', size: content.length, hash: createHash('sha256').update(content).digest('hex') }
}

async function restoreFile(workspace: string, relativePath: string, before: CheckpointFileRecord, checkpoints: CheckpointService) {
  const resolved = resolveInsideWorkspace(relativePath, workspace)
  const current = await inspectCurrent(workspace, relativePath)
  if (!before.exists) {
    if (current.kind !== 'file') throw new Error(`Não é seguro remover ${relativePath}.`)
    await fs.promises.unlink(resolved)
    return
  }
  if (before.kind !== 'file') throw new Error(`O rollback não suporta restaurar o tipo ${before.kind} em ${relativePath}.`)
  const content = await checkpoints.readContent(before)
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 })
  await writeAtomicBuffer(resolved, content)
  if (before.mode !== null) await fs.promises.chmod(resolved, before.mode)
}

async function writeAtomicBuffer(filePath: string, content: Buffer) {
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
