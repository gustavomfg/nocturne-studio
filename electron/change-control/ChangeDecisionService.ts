import type { ChangeRecord, ChangeSetRecord } from '../../shared/changeControl'
import type { ChangeSetRepository } from '../database/ChangeSetRepository'
import type { SnapshotRollbackService } from './SnapshotRollbackService'
import { enqueueSerializedWrite } from '../persistence/SerializedWriteQueue'

/** Applies explicit file decisions and derives the aggregate ChangeSet state. */
export class ChangeDecisionService {
  constructor(
    private readonly repository: ChangeSetRepository,
    private readonly rollback: SnapshotRollbackService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  decide(executionId: string, changeId: string, status: Extract<ChangeRecord['status'], 'accepted' | 'rejected'>, workspace: string, revertingBuild = false) {
    return enqueueSerializedWrite(`decision:${workspace}`, () => this.apply(executionId, changeId, status, workspace, revertingBuild))
  }

  private async apply(executionId: string, changeId: string, status: 'accepted' | 'rejected', workspace: string, revertingBuild: boolean) {
    const change = this.repository.getChange(changeId, executionId)
    if (!change) throw new Error('A mudança solicitada não pertence a esta execução.')
    if (change.policy === 'blocked') throw new Error('Esta mudança está bloqueada pela política do workspace.')
    if (change.status === 'conflicted') throw new Error('Esta mudança está em conflito e precisa ser reprocessada antes da decisão.')
    if (change.status !== 'pending' && change.status !== 'edited' && !(revertingBuild && status === 'rejected' && change.status === 'accepted')) throw new Error('Esta mudança já possui uma decisão persistida.')
    const changeSet = this.repository.getById(change.changeSetId, executionId)
    if (!changeSet) throw new Error('O ChangeSet da mudança não está disponível.')
    const operationId = this.repository.reserveDecision(executionId, changeId, status)
    try {
      const conflicts = await this.rollback.verifyPaths(executionId, workspace, changeSet.afterCheckpointId, [change.relativePath])
      if (conflicts.length) throw new Error(`O arquivo mudou desde AFTER: ${conflicts.join(', ')}.`)
      if (status === 'rejected') {
        const result = await this.rollback.rollbackPaths(executionId, workspace, changeSet.beforeCheckpointId, changeSet.afterCheckpointId, [change.relativePath])
        if (result.status !== 'restored') throw new Error(`Rollback em conflito: ${result.conflicts.join(', ')}. Recuperação: ${result.recoveryDirectory ?? 'checkpoints preservados'}.`)
      }
    const updatedChange = { ...change, status, updatedAt: this.now().toISOString() }
    const changes = this.repository.listChanges(changeSet.id).map((item) => item.id === changeId ? updatedChange : item)
    const updatedSet: ChangeSetRecord = { ...changeSet, status: aggregateStatus(changes), updatedAt: this.now().toISOString() }
    this.repository.saveDecision(updatedSet, updatedChange, operationId)
    return { changeSet: updatedSet, change: updatedChange }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.failDecision(operationId, message)
      const conflicted = { ...change, status: 'conflicted' as const, updatedAt: this.now().toISOString() }
      this.repository.saveDecision({ ...changeSet, status: 'conflicted', updatedAt: conflicted.updatedAt }, conflicted)
      throw error
    }
  }
}

function aggregateStatus(changes: ChangeRecord[]): ChangeSetRecord['status'] {
  if (changes.some((change) => change.status === 'conflicted')) return 'conflicted'
  if (changes.every((change) => change.status === 'accepted')) return 'accepted'
  if (changes.every((change) => change.status === 'rejected')) return 'rejected'
  if (changes.some((change) => change.status === 'accepted' || change.status === 'rejected')) return 'partially-accepted'
  return 'pending'
}
