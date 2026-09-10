import type { LocalDatabase } from '../database/Database'
import type { SnapshotRollbackService } from '../change-control/SnapshotRollbackService'
import { ChangeDecisionService } from '../change-control/ChangeDecisionService'

export interface BuildRollbackStatus {
  available: boolean
  files: string[]
  createdAt?: string
  reason?: string
  executionId?: string
}

/** Whole-Build rollback uses the same immutable checkpoints as file rejection. */
export class BuildRollbackService {
  constructor(private readonly database: LocalDatabase, private readonly snapshots: SnapshotRollbackService) {}

  private latest(conversationId: string) {
    const conversation = this.database.getConversation(conversationId)
    if (!conversation) return null
    const execution = this.database.listExecutions(conversation.workspace, conversationId).find((item) => item.mode === 'build')
    if (!execution || !['completed', 'failed', 'cancelled'].includes(execution.status)) return null
    const changeSet = this.database.changeSets.list(execution.id)[0]
    return changeSet ? { execution, changeSet } : null
  }

  status(conversationId: string): BuildRollbackStatus {
    const value = this.latest(conversationId)
    if (!value) return { available: false, files: [], reason: 'Nenhum Build com BEFORE/AFTER disponível.' }
    const changes = this.database.changeSets.listChanges(value.changeSet.id)
    const files = changes.filter((change) => change.status !== 'rejected').map((change) => change.relativePath)
    const available = files.length > 0 && !changes.some((change) => change.policy === 'blocked' || change.status === 'conflicted')
    return { available, files, executionId: value.execution.id, createdAt: value.changeSet.createdAt, ...(!available ? { reason: 'Build já revertido ou com conflito que exige reconciliação.' } : {}) }
  }

  async rollback(conversationId: string, workspace: string, expectedExecutionId?: string) {
    const value = this.latest(conversationId)
    const status = this.status(conversationId)
    if (!value || value.execution.workspace !== workspace || !status.available) throw new Error(status.reason ?? 'Rollback indisponível.')
    if (expectedExecutionId && value.execution.id !== expectedExecutionId) throw new Error('O Build mudou durante a confirmação. Revise novamente antes de reverter.')
    const conflicts = await this.snapshots.verifyPaths(value.execution.id, workspace, value.changeSet.afterCheckpointId, status.files)
    if (conflicts.length) throw new Error(`Rollback em conflito: ${conflicts.join(', ')}.`)
    const decisions = new ChangeDecisionService(this.database.changeSets, this.snapshots)
    const restored: string[] = []
    for (const change of this.database.changeSets.listChanges(value.changeSet.id)) {
      if (!status.files.includes(change.relativePath)) continue
      await decisions.decide(value.execution.id, change.id, 'rejected', workspace, true)
      restored.push(change.relativePath)
    }
    return { restored }
  }
}
