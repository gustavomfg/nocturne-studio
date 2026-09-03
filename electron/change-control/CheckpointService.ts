import { randomUUID } from 'node:crypto'
import type { CheckpointFileRecord, CheckpointRecord } from '../../shared/changeControl'
import type { CheckpointRepository } from '../database/CheckpointRepository'
import { WorkspaceCheckpointStore } from './WorkspaceCheckpointStore'

/** Coordinates durable checkpoint manifests and private snapshot bytes. */
export class CheckpointService {
  constructor(
    private readonly repository: CheckpointRepository,
    private readonly store: WorkspaceCheckpointStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async capture(executionId: string, workspace: string, phase: CheckpointRecord['phase'], requestedPaths?: readonly string[]) {
    const checkpoint: CheckpointRecord = {
      id: randomUUID(), executionId, workspace, phase, status: 'capturing',
      capturedAt: this.now().toISOString(), rootPath: '', error: null,
    }
    this.repository.create(checkpoint)
    try {
      const files = await this.store.capture(workspace, checkpoint.id, requestedPaths)
      checkpoint.status = 'ready'
      checkpoint.rootPath = this.storeRoot(checkpoint.id)
      this.repository.replaceFiles(checkpoint.id, files)
      this.repository.update(checkpoint)
      return { checkpoint, files }
    } catch (error) {
      checkpoint.status = 'failed'
      checkpoint.error = error instanceof Error ? error.message : String(error)
      checkpoint.capturedAt = this.now().toISOString()
      this.repository.update(checkpoint)
      throw error
    }
  }

  get(id: string, executionId?: string) {
    return this.repository.get(id, executionId)
  }

  list(executionId: string) {
    return this.repository.list(executionId)
  }

  listFiles(id: string): CheckpointFileRecord[] {
    return this.repository.listFiles(id)
  }

  readContent(file: CheckpointFileRecord) {
    return this.store.readContent(file)
  }

  private storeRoot(checkpointId: string) {
    return this.store.pathFor(checkpointId)
  }
}
