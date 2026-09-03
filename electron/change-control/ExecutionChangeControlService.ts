import type { ChangeOrigin, CheckpointRecord } from '../../shared/changeControl'
import type { ChangeCaptureService } from './ChangeCaptureService'
import type { CheckpointService } from './CheckpointService'
import type { WorkspaceChangeGate } from './WorkspaceChangeGate'

interface ActiveControl {
  workspace: string
  before: CheckpointRecord
}

/** Coordinates one durable BEFORE/AFTER pair for each Build execution. */
export class ExecutionChangeControlService {
  private readonly active = new Map<string, ActiveControl>()
  private readonly pending = new Map<string, string>()

  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly changes: ChangeCaptureService,
    private readonly gate: WorkspaceChangeGate,
  ) {}

  async begin(executionId: string, workspace: string) {
    this.gate.begin(workspace)
    try {
      const before = await this.checkpoints.capture(executionId, workspace, 'before')
      this.active.set(executionId, { workspace, before: before.checkpoint })
      return before.checkpoint
    } catch (error) {
      this.gate.release(workspace)
      throw error
    }
  }

  async complete(executionId: string, workspace: string, origin: ChangeOrigin, requestedPaths?: readonly string[]) {
    const current = this.active.get(executionId)
    if (!current) return null
    this.active.delete(executionId)
    if (current.workspace !== workspace) throw new Error('A execução mudou de workspace antes da captura AFTER.')
    try {
      const captured = await this.changes.capture(executionId, workspace, current.before.id, origin, requestedPaths)
      if (captured.changes.length) this.pending.set(executionId, workspace)
      else this.gate.release(workspace)
      return captured
    } catch (error) {
      this.gate.release(workspace)
      throw error
    }
  }

  abort(executionId: string) {
    const current = this.active.get(executionId)
    this.active.delete(executionId)
    this.pending.delete(executionId)
    if (current) this.gate.release(current.workspace)
  }

  resolve(executionId: string) {
    const workspace = this.pending.get(executionId)
    if (!workspace) return false
    this.pending.delete(executionId)
    this.gate.release(workspace)
    return true
  }

  hasPending(workspace: string) {
    return [...this.pending.values()].some((value) => value === workspace)
  }

  before(executionId: string) {
    return this.active.get(executionId)?.before ?? null
  }
}
