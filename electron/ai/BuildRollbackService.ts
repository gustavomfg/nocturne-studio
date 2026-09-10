import type { LocalDatabase } from '../database/Database'
import type { SnapshotRollbackService } from '../change-control/SnapshotRollbackService'

export interface BuildRollbackStatus {
  available: boolean
  files: string[]
  createdAt?: string
  reason?: string
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
    return { available, files, createdAt: value.changeSet.createdAt, ...(!available ? { reason: 'Build já revertido ou com conflito que exige reconciliação.' } : {}) }
  }

  async rollback(conversationId: string, workspace: string) {
    const value = this.latest(conversationId)
    const status = this.status(conversationId)
    if (!value || value.execution.workspace !== workspace || !status.available) throw new Error(status.reason ?? 'Rollback indisponível.')
    const result = await this.snapshots.rollbackPaths(value.execution.id, workspace, value.changeSet.beforeCheckpointId, value.changeSet.afterCheckpointId, status.files)
    if (result.status === 'conflicted') throw new Error(`Rollback interrompido; conflito em ${result.conflicts.join(', ')}. Restaurados: ${result.restored.join(', ') || 'nenhum'}. Recuperação: ${result.recoveryDirectory ?? 'checkpoints preservados'}.`)
    return { restored: result.restored }
  }
}
