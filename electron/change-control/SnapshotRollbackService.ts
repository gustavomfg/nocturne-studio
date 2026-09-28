import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CheckpointFileRecord, CheckpointRecord } from '../../shared/changeControl'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'
import type { CheckpointService } from './CheckpointService'
import { enqueueSerializedWrite } from '../persistence/SerializedWriteQueue'
import { NativeBoundaryError, NativeRollbackOperation, withRollbackRootBinding, type BoundaryOutcome } from './NativeRollbackOperation'

export interface SnapshotRollbackResult {
  status: 'restored' | 'conflicted'
  restored: string[]
  conflicts: string[]
  recoveryDirectory?: string
  boundaryOutcome?: BoundaryOutcome
  error?: string
}

interface CurrentState {
  exists: boolean
  kind: CheckpointFileRecord['kind']
  size: number | null
  hash: string | null
  mode: number | null
}

/** Checkpoints authorize bytes; only native capabilities authorize workspace mutation. */
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

  async rollbackPaths(executionId: string, workspace: string, beforeId: string, afterId: string, requestedPaths?: readonly string[], expectedRootIdentity?: string): Promise<SnapshotRollbackResult> {
    return enqueueSerializedWrite(`rollback:${path.resolve(workspace)}`, () => this.restore(executionId, workspace, beforeId, afterId, requestedPaths, expectedRootIdentity))
  }

  private async restore(executionId: string, workspace: string, beforeId: string, afterId: string, requestedPaths?: readonly string[], expectedRootIdentity?: string): Promise<SnapshotRollbackResult> {
    const before = this.checkpoints.get(beforeId, executionId)
    const after = this.checkpoints.get(afterId, executionId)
    if (!before || !after || before.status !== 'ready' || after.status !== 'ready') throw new Error('Os checkpoints necessários para o rollback não estão disponíveis.')
    if (before.workspace !== workspace || after.workspace !== workspace) throw new Error('O rollback não corresponde ao workspace autorizado.')
    // Retain the observed root across asynchronous preparation; its identity
    // cannot be recycled or silently replaced before native acquisition.
    return withRollbackRootBinding(workspace, expectedRootIdentity, (identity) => this.restoreFiles(executionId, workspace, before, after, requestedPaths, identity))
  }

  private async restoreFiles(executionId: string, workspace: string, before: CheckpointRecord, after: CheckpointRecord, requestedPaths: readonly string[] | undefined, expectedRootIdentity: string | undefined): Promise<SnapshotRollbackResult> {
    const beforeId = before.id, afterId = after.id
    const beforeFiles = new Map(this.checkpoints.listFiles(before.id).map((file) => [file.relativePath, file]))
    const afterFiles = new Map(this.checkpoints.listFiles(after.id).map((file) => [file.relativePath, file]))
    const paths = requestedPaths ? [...new Set(requestedPaths)].sort() : [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()
    const conflicts: string[] = []
    const restorations: Array<{ relativePath: string; before: CheckpointFileRecord; after: CheckpointFileRecord }> = []
    for (const relativePath of paths) {
      resolveInsideWorkspace(relativePath, workspace)
      const original = beforeFiles.get(relativePath) ?? missingFile(before.id, relativePath)
      const expected = afterFiles.get(relativePath) ?? missingFile(after.id, relativePath)
      if (sameState(original, expected)) continue
      if (!sameState(await inspectCurrent(workspace, relativePath), expected)) conflicts.push(relativePath)
      else restorations.push({ relativePath, before: original, after: expected })
    }
    if (conflicts.length) return { status: 'conflicted', restored: [], conflicts }
    if (!restorations.length) return { status: 'restored', restored: [], conflicts: [] }

    const operationId = randomUUID()
    const recoveryDirectory = this.checkpoints.recoveryPath(operationId)
    // This is the separately authorized private application store, NEVER a project pathname.
    await fs.promises.mkdir(recoveryDirectory, { recursive: true, mode: 0o700 })
    const restored: string[] = []
    const journal = {
      contract: 'native-rollback-v1', operationId, executionId, beforeId, afterId, workspace,
      status: 'running', restored, paths: restorations.map((item) => item.relativePath),
      step: 'acquire', retained: [] as string[], outcome: null as BoundaryOutcome | null,
      rootIdentity: '', recoveryIdentity: '',
      observations: [] as Array<{ path: string; parentIdentity: string; afterIdentity: string; stagedIdentity: string | null; beforeHash: string | null; afterHash: string | null }>,
    }
    let operation: NativeRollbackOperation | undefined
    let currentPath = restorations[0].relativePath
    const persistJournal = (error?: string) => operation!.journal({ ...journal, ...(error ? { error } : {}) }, {
      operationId, executionId, beforeId, afterId, workspace, step: journal.step,
      status: journal.status, outcome: journal.outcome, restoredCount: restored.length,
      observation: journal.observations.at(-1), retained: journal.retained.at(-1),
      ...(error ? { error } : {}),
    })
    try {
      operation = await NativeRollbackOperation.create(workspace, recoveryDirectory, expectedRootIdentity)
      journal.rootIdentity = operation.rootIdentity
      journal.recoveryIdentity = operation.recoveryIdentity
      await persistJournal()
      for (const [index, restoration] of restorations.entries()) {
        currentPath = restoration.relativePath
        if (index) await operation.next()
        const observed = await operation.inspect(currentPath)
        const current: CurrentState = observed.exists
          ? { exists: true, kind: 'file', mode: observed.mode, size: observed.content.length, hash: createHash('sha256').update(observed.content).digest('hex') }
          : { exists: false, kind: 'missing', mode: null, size: null, hash: null }
        if (!sameState(current, restoration.after)) throw new NativeBoundaryError('CONFLICT', 'O arquivo não corresponde ao AFTER.')
        if ((restoration.before.exists && restoration.before.kind !== 'file') || (restoration.after.exists && restoration.after.kind !== 'file')) throw new NativeBoundaryError('UNSUPPORTED', 'Tipo de arquivo não restaurável.')
        const observation = { path: currentPath, parentIdentity: observed.parentIdentity, afterIdentity: observed.identity, stagedIdentity: null as string | null, beforeHash: restoration.before.hash, afterHash: restoration.after.hash }
        journal.observations.push(observation)
        if (restoration.before.exists) {
          const content = await this.checkpoints.readContent(restoration.before)
          if (createHash('sha256').update(content).digest('hex') !== restoration.before.hash) throw new NativeBoundaryError('CONFLICT', 'Checkpoint corrompido.')
          observation.stagedIdentity = (await operation.stage(content, restoration.before.mode ?? 0o600)).identity
        }
        const retentionEntry = `.nocturne-rollback-${operationId}-${index}.after`
        journal.step = `displace-intent:${currentPath}`
        if (restoration.after.exists) journal.retained.push(path.posix.join(path.posix.dirname(currentPath.replace(/\\/g, '/')), retentionEntry))
        await persistJournal()
        await operation.displace(retentionEntry)
        journal.step = `publish-intent:${currentPath}`
        await persistJournal()
        await operation.publish()
        restored.push(currentPath)
        journal.step = `verified:${currentPath}`
        await persistJournal()
      }
      journal.status = 'restored'
      await persistJournal()
      return { status: 'restored', restored, conflicts: [] }
    } catch (error) {
      journal.status = 'conflicted'
      journal.outcome = error instanceof NativeBoundaryError ? error.outcome : 'UNKNOWN'
      // No compensation, pathname cleanup or new workspace admission after failure.
      await operation?.revoke()
      if (operation) await persistJournal(error instanceof Error ? error.message : 'Operação interrompida.').catch(() => undefined)
      return { status: 'conflicted', restored, conflicts: [currentPath], recoveryDirectory, boundaryOutcome: journal.outcome, error: error instanceof Error ? error.message : 'Operação interrompida.' }
    } finally { await operation?.close() }
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
