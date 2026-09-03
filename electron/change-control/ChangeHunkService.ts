import { createHash, randomUUID } from 'node:crypto'
import type { ChangeHunkRecord, ChangeRecord } from '../../shared/changeControl'
import type { ChangeDiffService } from './ChangeDiffService'
import type { CheckpointService } from './CheckpointService'
import type { ChangeSetRepository } from '../database/ChangeSetRepository'

const MAX_PATCH_CHARACTERS = 200_000

/** Persists and validates per-file hunks without mutating the workspace. */
export class ChangeHunkService {
  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly diffs: ChangeDiffService,
    private readonly repository: ChangeSetRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(changeId: string, executionId?: string): Promise<ChangeHunkRecord[]> {
    const change = this.repository.getChange(changeId, executionId)
    if (!change) return []
    const existing = this.repository.listHunks(changeId)
    if (existing.length) return existing
    const diff = await this.diffs.get(changeId, executionId)
    if (!diff || diff.kind !== 'text' || !diff.unifiedDiff) return []
    const hunk: ChangeHunkRecord = {
      id: randomUUID(), changeId, sequence: 1, baseHash: change.beforeHash ?? emptyHash(),
      originalPatch: diff.unifiedDiff, finalPatch: diff.unifiedDiff, status: 'pending',
      startLine: 1, endLine: Math.max(1, change.beforeSize ? Math.min(2_000, await this.beforeLineCount(change)) : 1), decisionAt: null,
    }
    this.repository.createHunk(hunk)
    return [hunk]
  }

  async edit(hunkId: string, finalPatch: string, executionId?: string): Promise<ChangeHunkRecord> {
    if (finalPatch.length > MAX_PATCH_CHARACTERS) throw new Error('O patch excede o limite seguro de edição.')
    const hunk = this.repository.getHunk(hunkId)
    if (!hunk) throw new Error('Hunk não encontrado.')
    const change = this.repository.getChange(hunk.changeId, executionId)
    if (!change) throw new Error('A mudança do hunk não pertence à execução.')
    const valid = await this.validatePatch(change, finalPatch, executionId)
    const updated: ChangeHunkRecord = {
      ...hunk,
      finalPatch,
      status: valid ? 'edited' : 'conflicted',
      decisionAt: this.now().toISOString(),
    }
    this.repository.updateHunk(updated)
    return updated
  }

  async decide(hunkId: string, status: Extract<ChangeHunkRecord['status'], 'accepted' | 'rejected'>, executionId?: string) {
    const hunk = this.repository.getHunk(hunkId)
    if (!hunk) throw new Error('Hunk não encontrado.')
    if (executionId) {
      const change = this.repository.getChange(hunk.changeId, executionId)
      if (!change) throw new Error('A decisão do hunk não pertence à execução.')
    }
    const updated = { ...hunk, status, decisionAt: this.now().toISOString() }
    this.repository.updateHunk(updated)
    return updated
  }

  private async validatePatch(change: ChangeRecord, patch: string, executionId?: string) {
    const diff = await this.diffs.get(change.id, executionId)
    if (!diff || diff.kind !== 'text') return false
    const changeSet = this.repository.get(change.changeSetId, executionId ?? change.executionId)
    if (!changeSet) return false
    const before = this.checkpoints.listFiles(changeSet.beforeCheckpointId).find((file) => file.relativePath === change.relativePath)
    if (!before || before.kind !== 'file') return false
    const content = await this.checkpoints.readContent(before)
    if (change.beforeHash && createHash('sha256').update(content).digest('hex') !== change.beforeHash) return false
    try {
      applyPatch(content.toString('utf8'), patch)
      return true
    } catch {
      return false
    }
  }

  private async beforeLineCount(change: ChangeRecord) {
    const changeSet = this.repository.get(change.changeSetId, change.executionId)
    if (!changeSet) return 1
    const file = this.checkpoints.listFiles(changeSet.beforeCheckpointId).find((item) => item.relativePath === change.relativePath)
    if (!file || file.kind !== 'file') return 1
    const content = await this.checkpoints.readContent(file)
    return content.toString('utf8').split(/\r?\n/).filter((line, index, lines) => !(index === lines.length - 1 && line === '')).length
  }
}

function emptyHash() {
  return createHash('sha256').update('').digest('hex')
}

function applyPatch(before: string, patch: string) {
  const source = before.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (source[source.length - 1] === '') source.pop()
  const patchLines = patch.split('\n').slice(3)
  const result: string[] = []
  let index = 0
  for (const line of patchLines) {
    if (!line || line.startsWith('@@')) continue
    const prefix = line[0]
    const value = line.slice(1)
    if (prefix === ' ') {
      if (source[index] !== value) throw new Error('O contexto do hunk não corresponde ao BEFORE.')
      result.push(value)
      index += 1
    } else if (prefix === '-') {
      if (source[index] !== value) throw new Error('A remoção do hunk não corresponde ao BEFORE.')
      index += 1
    } else if (prefix === '+') {
      result.push(value)
    } else {
      throw new Error('Formato de patch não suportado.')
    }
  }
  result.push(...source.slice(index))
  return result.join('\n')
}
