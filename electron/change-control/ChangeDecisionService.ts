import type { ChangeRecord, ChangeSetRecord } from '../../shared/changeControl'
import type { ChangeSetRepository } from '../database/ChangeSetRepository'

/** Applies explicit file decisions and derives the aggregate ChangeSet state. */
export class ChangeDecisionService {
  constructor(
    private readonly repository: ChangeSetRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  decide(executionId: string, changeId: string, status: Extract<ChangeRecord['status'], 'accepted' | 'rejected'>) {
    const change = this.repository.getChange(changeId, executionId)
    if (!change) throw new Error('A mudança solicitada não pertence a esta execução.')
    const changeSet = this.repository.get(change.changeSetId, executionId)
    if (!changeSet) throw new Error('O ChangeSet da mudança não está disponível.')
    const updatedChange = { ...change, status, updatedAt: this.now().toISOString() }
    const changes = this.repository.listChanges(changeSet.id).map((item) => item.id === changeId ? updatedChange : item)
    const updatedSet: ChangeSetRecord = { ...changeSet, status: aggregateStatus(changes), updatedAt: this.now().toISOString() }
    this.repository.saveDecision(updatedSet, updatedChange)
    return { changeSet: updatedSet, change: updatedChange }
  }
}

function aggregateStatus(changes: ChangeRecord[]): ChangeSetRecord['status'] {
  if (changes.some((change) => change.status === 'conflicted')) return 'conflicted'
  if (changes.every((change) => change.status === 'accepted')) return 'accepted'
  if (changes.every((change) => change.status === 'rejected')) return 'rejected'
  if (changes.some((change) => change.status === 'accepted' || change.status === 'rejected')) return 'partially-accepted'
  return 'pending'
}
