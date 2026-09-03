import type { ChangeOrigin, CheckpointRecord } from '../../shared/changeControl'
import type { ChangeCaptureService } from './ChangeCaptureService'
import type { CheckpointService } from './CheckpointService'

interface ActiveControl {
  workspace: string
  before: CheckpointRecord
}

/** Coordinates one durable BEFORE/AFTER pair for each Build execution. */
export class ExecutionChangeControlService {
  private readonly active = new Map<string, ActiveControl>()

  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly changes: ChangeCaptureService,
  ) {}

  async begin(executionId: string, workspace: string) {
    const before = await this.checkpoints.capture(executionId, workspace, 'before')
    this.active.set(executionId, { workspace, before: before.checkpoint })
    return before.checkpoint
  }

  async complete(executionId: string, workspace: string, origin: ChangeOrigin, requestedPaths?: readonly string[]) {
    const current = this.active.get(executionId)
    if (!current) return null
    this.active.delete(executionId)
    if (current.workspace !== workspace) throw new Error('A execução mudou de workspace antes da captura AFTER.')
    return this.changes.capture(executionId, workspace, current.before.id, origin, requestedPaths)
  }

  abort(executionId: string) {
    this.active.delete(executionId)
  }

  before(executionId: string) {
    return this.active.get(executionId)?.before ?? null
  }
}
