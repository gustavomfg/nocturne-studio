import path from 'node:path'
import type { ChangeOrigin, CheckpointRecord } from '../../shared/changeControl'
import type { ChangeCaptureService } from './ChangeCaptureService'
import type { CheckpointService } from './CheckpointService'
import type { WorkspaceChangeGate } from './WorkspaceChangeGate'

interface ActiveControl {
  workspace: string
  before: CheckpointRecord
}

export interface ExecutionChangeControlMetrics {
  executionsStarted: number
  captures: number
  failedCaptures: number
  cancellations: number
  resolutions: number
  changedFiles: number
  conflicts: number
  totalCaptureDurationMs: number
  lastCaptureDurationMs: number | null
  pendingChangeSets: number
}

/** Coordinates one durable BEFORE/AFTER pair for each Build execution. */
export class ExecutionChangeControlService {
  private readonly active = new Map<string, ActiveControl>()
  private readonly pending = new Map<string, string>()
  private readonly metrics: ExecutionChangeControlMetrics = {
    executionsStarted: 0, captures: 0, failedCaptures: 0, cancellations: 0, resolutions: 0,
    changedFiles: 0, conflicts: 0, totalCaptureDurationMs: 0, lastCaptureDurationMs: null, pendingChangeSets: 0,
  }

  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly changes: ChangeCaptureService,
    private readonly gate: WorkspaceChangeGate,
  ) {}

  async begin(executionId: string, workspace: string) {
    this.gate.begin(workspace)
    this.metrics.executionsStarted += 1
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
    const started = Date.now()
    try {
      const captured = await this.changes.capture(executionId, workspace, current.before.id, origin, requestedPaths)
      const durationMs = Math.max(0, Date.now() - started)
      this.metrics.captures += 1
      this.metrics.changedFiles += captured.changes.length
      this.metrics.conflicts += captured.changes.filter((change) => change.status === 'conflicted').length
      this.metrics.totalCaptureDurationMs += durationMs
      this.metrics.lastCaptureDurationMs = durationMs
      if (captured.changes.length) this.pending.set(executionId, workspace)
      else this.releaseWhenIdle(workspace)
      this.metrics.pendingChangeSets = this.pending.size
      return captured
    } catch (error) {
      this.metrics.failedCaptures += 1
      this.releaseWhenIdle(workspace)
      throw error
    }
  }

  abort(executionId: string) {
    const current = this.active.get(executionId)
    this.active.delete(executionId)
    this.pending.delete(executionId)
    if (current) {
      this.metrics.cancellations += 1
      this.releaseWhenIdle(current.workspace)
    }
    this.metrics.pendingChangeSets = this.pending.size
  }

  resolve(executionId: string) {
    const workspace = this.pending.get(executionId)
    if (!workspace) return false
    this.pending.delete(executionId)
    this.metrics.resolutions += 1
    this.releaseWhenIdle(workspace)
    this.metrics.pendingChangeSets = this.pending.size
    return true
  }

  hasPending(workspace: string) {
    return [...this.pending.values()].some((value) => path.resolve(value) === path.resolve(workspace))
  }

  before(executionId: string) {
    return this.active.get(executionId)?.before ?? null
  }

  getMetrics(): ExecutionChangeControlMetrics {
    return { ...this.metrics, pendingChangeSets: this.pending.size }
  }

  private releaseWhenIdle(workspace: string) {
    const normalized = path.resolve(workspace)
    const active = [...this.active.values()].some((value) => path.resolve(value.workspace) === normalized)
    const pending = [...this.pending.values()].some((value) => path.resolve(value) === normalized)
    if (!active && !pending) this.gate.release(normalized)
  }
}
