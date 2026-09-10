import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CheckpointFileRecord } from '../../shared/changeControl'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'
import type { CheckpointService } from './CheckpointService'
import { enqueueSerializedWrite } from '../persistence/SerializedWriteQueue'
import { writeAtomicFile } from '../persistence/AtomicFile'

export interface SnapshotRollbackResult {
  status: 'restored' | 'conflicted'
  restored: string[]
  conflicts: string[]
  recoveryDirectory?: string
}

interface CurrentState {
  exists: boolean
  kind: CheckpointFileRecord['kind']
  size: number | null
  hash: string | null
  mode: number | null
}

/** Restores a checkpoint only when every target still matches the expected AFTER state. */
export class SnapshotRollbackService {
  constructor(private readonly checkpoints: CheckpointService) {}

  async verifyPaths(executionId: string, workspace: string, checkpointId: string, paths: readonly string[]) {
    const checkpoint = this.checkpoints.get(checkpointId, executionId)
    if (!checkpoint || checkpoint.workspace !== workspace || checkpoint.status !== 'ready') throw new Error('Checkpoint indisponível.')
    const files = new Map(this.checkpoints.listFiles(checkpointId).map((file) => [file.relativePath, file]))
    const conflicts: string[] = []
    for (const relativePath of paths) {
      if (!sameState(await inspectCurrent(workspace, relativePath), files.get(relativePath) ?? missingFile(checkpointId, relativePath))) conflicts.push(relativePath)
    }
    return conflicts
  }

  async rollback(executionId: string, workspace: string, beforeId: string, afterId: string): Promise<SnapshotRollbackResult> {
    return this.rollbackPaths(executionId, workspace, beforeId, afterId)
  }

  async rollbackPaths(executionId: string, workspace: string, beforeId: string, afterId: string, requestedPaths?: readonly string[]): Promise<SnapshotRollbackResult> {
    return enqueueSerializedWrite(`rollback:${path.resolve(workspace)}`, () => this.restore(executionId, workspace, beforeId, afterId, requestedPaths))
  }

  private async restore(executionId: string, workspace: string, beforeId: string, afterId: string, requestedPaths?: readonly string[]): Promise<SnapshotRollbackResult> {
    const before = this.checkpoints.get(beforeId, executionId)
    const after = this.checkpoints.get(afterId, executionId)
    if (!before || !after || before.status !== 'ready' || after.status !== 'ready') throw new Error('Os checkpoints necessários para o rollback não estão disponíveis.')
    if (before.workspace !== workspace || after.workspace !== workspace) throw new Error('O rollback não corresponde ao workspace autorizado.')
    const beforeFiles = new Map(this.checkpoints.listFiles(before.id).map((file) => [file.relativePath, file]))
    const afterFiles = new Map(this.checkpoints.listFiles(after.id).map((file) => [file.relativePath, file]))
    const paths = requestedPaths
      ? [...new Set(requestedPaths.map((relativePath) => {
        resolveInsideWorkspace(relativePath, workspace)
        return relativePath
      }))].sort()
      : [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()
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
    // Keep displaced bytes and a durable intent before touching the workspace.
    // Exclusive links publish restored files without replacing a racing writer.
    const recoveryDirectory = resolveInsideWorkspace(`.nocturne/rollback/${randomUUID()}`, workspace)
    await fs.promises.mkdir(recoveryDirectory, { recursive: true, mode: 0o700 })
    const journal = { executionId, beforeId, afterId, status: 'running', restored, paths: restorations.map((item) => item.relativePath) }
    const journalPath = path.join(recoveryDirectory, 'operation.json')
    await writeAtomicFile(journalPath, JSON.stringify(journal))
    for (const restoration of restorations) {
      try {
        await restoreFile(workspace, restoration.relativePath, restoration.before, restoration.after, this.checkpoints, recoveryDirectory)
        restored.push(restoration.relativePath)
        await writeAtomicFile(journalPath, JSON.stringify(journal))
      } catch {
        journal.status = 'conflicted'
        await writeAtomicFile(journalPath, JSON.stringify(journal))
        return { status: 'conflicted', restored, conflicts: [restoration.relativePath], recoveryDirectory }
      }
    }
    journal.status = 'restored'
    await writeAtomicFile(journalPath, JSON.stringify(journal))
    return { status: 'restored', restored, conflicts: [] }
  }
}

function missingFile(checkpointId: string, relativePath: string): CheckpointFileRecord {
  return { id: `missing-${checkpointId}-${relativePath}`, checkpointId, relativePath, exists: false, kind: 'missing', size: null, mode: null, hash: null, contentPath: null }
}

function sameState(left: CheckpointFileRecord | CurrentState, right: CheckpointFileRecord | CurrentState) {
  return left.exists === right.exists && left.kind === right.kind && left.size === right.size && left.hash === right.hash && left.mode === right.mode
}

async function inspectCurrent(workspace: string, relativePath: string): Promise<CurrentState> {
  const resolved = resolveInsideWorkspace(relativePath, workspace)
  const stat = await fs.promises.lstat(resolved).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!stat) return { exists: false, kind: 'missing', size: null, hash: null, mode: null }
  if (!stat.isFile()) return { exists: true, kind: stat.isDirectory() ? 'directory' : 'symlink', size: stat.size, hash: null, mode: stat.mode }
  const content = await fs.promises.readFile(resolved)
  return { exists: true, kind: 'file', size: content.length, hash: createHash('sha256').update(content).digest('hex'), mode: stat.mode }
}

async function restoreFile(workspace: string, relativePath: string, before: CheckpointFileRecord, after: CheckpointFileRecord, checkpoints: CheckpointService, recoveryDirectory: string) {
  if ((before.exists && before.kind !== 'file') || (after.exists && after.kind !== 'file')) throw new Error('Tipo não restaurável com segurança.')
  const content = before.exists ? await checkpoints.readContent(before) : null
  if (content && createHash('sha256').update(content).digest('hex') !== before.hash) throw new Error('Checkpoint corrompido.')
  const resolved = resolveInsideWorkspace(relativePath, workspace)
  const current = await inspectCurrent(workspace, relativePath)
  if (!sameState(current, after)) throw new Error('O arquivo não corresponde ao AFTER.')
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 })
  const displaced = path.join(recoveryDirectory, `${createHash('sha256').update(relativePath).digest('hex')}.after`)
  if (after.exists) {
    await fs.promises.rename(resolved, displaced)
    const moved = await inspectCurrent(workspace, path.relative(workspace, displaced))
    if (!sameState(moved, after)) {
      // Never overwrite an external replacement to put the displaced file back.
      await fs.promises.link(displaced, resolved).catch(() => undefined)
      throw new Error('Alteração concorrente preservada no diretório de recuperação.')
    }
  }
  try {
    if (content) await writeExclusiveBuffer(resolved, content, before.mode ?? 0o600)
    if (after.exists && !sameState(await inspectCurrent(workspace, path.relative(workspace, displaced)), after)) throw new Error('O arquivo deslocado recebeu uma edição concorrente.')
    if (!sameState(await inspectCurrent(workspace, relativePath), before)) throw new Error('O estado produzido mudou durante o rollback.')
  } catch (error) {
    if (after.exists) await fs.promises.link(displaced, resolved).catch(() => undefined)
    throw error
  }
}

async function writeExclusiveBuffer(filePath: string, content: Buffer, mode: number) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  let handle: fs.promises.FileHandle | undefined
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.promises.chmod(temporary, mode)
    await fs.promises.link(temporary, filePath)
    await fs.promises.unlink(temporary)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.promises.unlink(temporary).catch(() => undefined)
    throw error
  }
}
