import { randomUUID } from 'node:crypto'
import type { ChangeOperation, ChangeOrigin, ChangeRecord, ChangeSetRecord, CheckpointFileRecord } from '../../shared/changeControl'
import type { ChangeSetRepository } from '../database/ChangeSetRepository'
import type { CheckpointService } from './CheckpointService'

/** Builds a bounded, file-level ChangeSet from two durable checkpoint manifests. */
export class ChangeCaptureService {
  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly repository: ChangeSetRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async capture(executionId: string, workspace: string, beforeCheckpointId: string, origin: ChangeOrigin, requestedPaths?: readonly string[]) {
    const before = this.checkpoints.get(beforeCheckpointId, executionId)
    if (!before || before.status !== 'ready' || before.workspace !== workspace) throw new Error('O checkpoint BEFORE não está disponível para capturar mudanças.')
    const afterResult = await this.checkpoints.capture(executionId, workspace, 'after', requestedPaths)
    const beforeFiles = new Map(this.checkpoints.listFiles(before.id).map((file) => [file.relativePath, file]))
    const afterFiles = new Map(afterResult.files.map((file) => [file.relativePath, file]))
    const changes = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort().flatMap((relativePath) => {
      const original = beforeFiles.get(relativePath) ?? missingFile(before.id, relativePath)
      const next = afterFiles.get(relativePath) ?? missingFile(afterResult.checkpoint.id, relativePath)
      if (sameState(original, next)) return []
      const now = this.now().toISOString()
      const change: ChangeRecord = {
        id: randomUUID(), executionId, changeSetId: '', checkpointId: before.id, relativePath,
        originalPath: null, operation: operationFor(original, next), origin,
        beforeHash: original.hash, afterHash: next.hash, beforeSize: original.size, afterSize: next.size,
        status: 'pending', validationStatus: 'unknown', createdAt: now, updatedAt: now,
      }
      return [change]
    })
    const changeSet: ChangeSetRecord = {
      id: randomUUID(), executionId, beforeCheckpointId: before.id, afterCheckpointId: afterResult.checkpoint.id,
      status: changes.length ? 'pending' : 'accepted', createdAt: this.now().toISOString(), updatedAt: this.now().toISOString(),
    }
    const linked = changes.map((change) => ({ ...change, changeSetId: changeSet.id }))
    this.repository.save(changeSet, linked)
    return { changeSet, changes: linked, afterCheckpoint: afterResult.checkpoint }
  }

  get(id: string, executionId?: string) {
    return this.repository.get(id, executionId)
  }

  list(executionId: string) {
    return this.repository.list(executionId)
  }

  listChanges(changeSetId: string) {
    return this.repository.listChanges(changeSetId)
  }
}

function missingFile(checkpointId: string, relativePath: string): CheckpointFileRecord {
  return { id: `missing-${checkpointId}-${relativePath}`, checkpointId, relativePath, exists: false, kind: 'missing', size: null, mode: null, hash: null, contentPath: null }
}

function sameState(left: CheckpointFileRecord, right: CheckpointFileRecord) {
  return left.exists === right.exists && left.kind === right.kind && left.size === right.size && left.hash === right.hash
}

function operationFor(before: CheckpointFileRecord, after: CheckpointFileRecord): ChangeOperation {
  if (!before.exists && after.exists) return 'create'
  if (before.exists && !after.exists) return 'delete'
  return 'modify'
}
