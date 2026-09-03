import type { ChangeRecord, CheckpointFileRecord, FileDiff } from '../../shared/changeControl'
import type { ChangeSetRepository } from '../database/ChangeSetRepository'
import type { CheckpointService } from './CheckpointService'

const MAX_TEXT_BYTES = 1_024 * 1_024
const MAX_TEXT_LINES = 2_000
const MAX_DIFF_LINES = 4_000
const MAX_DIFF_CHARS = 200_000

interface DiffLine {
  prefix: ' ' | '+' | '-'
  value: string
}

/** Produces bounded, review-safe diffs from immutable checkpoint content. */
export class ChangeDiffService {
  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly repository: ChangeSetRepository,
  ) {}

  async get(changeId: string, executionId?: string): Promise<FileDiff | null> {
    const change = this.repository.getChange(changeId, executionId)
    if (!change) return null
    const changeSet = this.repository.get(change.changeSetId, executionId ?? change.executionId)
    if (!changeSet) return null
    const before = findFile(this.checkpoints.listFiles(changeSet.beforeCheckpointId), change.relativePath)
    const after = findFile(this.checkpoints.listFiles(changeSet.afterCheckpointId), change.relativePath)
    return this.build(change, before, after)
  }

  async list(changeSetId: string, executionId?: string): Promise<FileDiff[]> {
    const changeSet = this.repository.get(changeSetId, executionId)
    if (!changeSet) return []
    const beforeFiles = new Map(this.checkpoints.listFiles(changeSet.beforeCheckpointId).map((file) => [file.relativePath, file]))
    const afterFiles = new Map(this.checkpoints.listFiles(changeSet.afterCheckpointId).map((file) => [file.relativePath, file]))
    return Promise.all(this.repository.listChanges(changeSetId).map((change) => this.build(
      change,
      beforeFiles.get(change.relativePath),
      afterFiles.get(change.relativePath),
    )))
  }

  private async build(change: ChangeRecord, before: CheckpointFileRecord | undefined, after: CheckpointFileRecord | undefined): Promise<FileDiff> {
    const base = {
      changeId: change.id,
      relativePath: change.relativePath,
      operation: change.operation,
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
    }
    if (!before?.exists || !after?.exists) {
      const present = before?.exists ? before : after
      if (present?.kind !== 'file') return { ...base, kind: 'missing', unifiedDiff: '', additions: 0, deletions: 0, truncated: false }
    }
    if (before?.kind !== 'file' || after?.kind !== 'file') return { ...base, kind: 'unsupported', unifiedDiff: '', additions: 0, deletions: 0, truncated: false }
    if ((before.size ?? 0) > MAX_TEXT_BYTES || (after.size ?? 0) > MAX_TEXT_BYTES) {
      return { ...base, kind: 'large', unifiedDiff: '', additions: 0, deletions: 0, truncated: true }
    }
    const [beforeContent, afterContent] = await Promise.all([this.checkpoints.readContent(before), this.checkpoints.readContent(after)])
    if (looksBinary(beforeContent) || looksBinary(afterContent)) {
      return {
        ...base,
        kind: 'binary',
        unifiedDiff: `Binary files a/${change.relativePath} and b/${change.relativePath} differ`,
        additions: 0,
        deletions: 0,
        truncated: false,
      }
    }
    const beforeLines = toLines(beforeContent.toString('utf8'))
    const afterLines = toLines(afterContent.toString('utf8'))
    if (beforeLines.length > MAX_TEXT_LINES || afterLines.length > MAX_TEXT_LINES) {
      return { ...base, kind: 'large', unifiedDiff: '', additions: 0, deletions: 0, truncated: true }
    }
    const lines = diffLines(beforeLines, afterLines)
    const rendered = renderDiff(change.relativePath, lines)
    return {
      ...base,
      kind: 'text',
      unifiedDiff: rendered.text.slice(0, MAX_DIFF_CHARS),
      additions: rendered.additions,
      deletions: rendered.deletions,
      truncated: rendered.text.length > MAX_DIFF_CHARS || lines.length > MAX_DIFF_LINES,
    }
  }
}

function findFile(files: CheckpointFileRecord[], relativePath: string) {
  return files.find((file) => file.relativePath === relativePath)
}

function looksBinary(content: Buffer) {
  const sample = content.subarray(0, Math.min(content.length, 8_192))
  return sample.includes(0)
}

function toLines(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function diffLines(before: string[], after: string[]): DiffLine[] {
  const rows = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      rows[beforeIndex][afterIndex] = before[beforeIndex] === after[afterIndex]
        ? rows[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(rows[beforeIndex + 1][afterIndex], rows[beforeIndex][afterIndex + 1])
    }
  }
  const result: DiffLine[] = []
  let beforeIndex = 0
  let afterIndex = 0
  while (beforeIndex < before.length || afterIndex < after.length) {
    if (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
      result.push({ prefix: ' ', value: before[beforeIndex] })
      beforeIndex += 1
      afterIndex += 1
    } else if (afterIndex < after.length && (beforeIndex === before.length || rows[beforeIndex][afterIndex + 1] >= rows[beforeIndex + 1][afterIndex])) {
      result.push({ prefix: '+', value: after[afterIndex] })
      afterIndex += 1
    } else {
      result.push({ prefix: '-', value: before[beforeIndex] })
      beforeIndex += 1
    }
  }
  return result
}

function renderDiff(relativePath: string, lines: DiffLine[]) {
  const additions = lines.filter((line) => line.prefix === '+').length
  const deletions = lines.filter((line) => line.prefix === '-').length
  const text = [`--- a/${relativePath}`, `+++ b/${relativePath}`, `@@ -1,${Math.max(1, deletions)} +1,${Math.max(1, additions)} @@`, ...lines.map((line) => `${line.prefix}${line.value}`)].join('\n')
  return { text, additions, deletions }
}
