import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { ChangeDiffService } from '../electron/change-control/ChangeDiffService'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

async function fixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-diff-db-'))
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-diff-project-'))
  directories.push(userData, workspace)
  const database = new LocalDatabase(userData)
  databases.push(database)
  const conversation = database.createConversation(workspace)
  const executionId = '00000000-0000-4000-8000-000000000040'
  database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'diff', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
  const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))
  return { database, workspace, executionId, checkpoints, capture: new ChangeCaptureService(checkpoints, database.changeSets) }
}

describe('ChangeDiffService', () => {
  it('gera diff textual delimitado por arquivo', async () => {
    const { database, workspace, executionId, checkpoints, capture } = await fixture()
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'antes\nigual\n')
    const before = await checkpoints.capture(executionId, workspace, 'before')
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'depois\nigual\n')
    const result = await capture.capture(executionId, workspace, before.checkpoint.id, 'codex-file-change', ['file.txt'])
    const diff = await new ChangeDiffService(checkpoints, database.changeSets).get(result.changes[0].id, executionId)
    expect(diff).toMatchObject({ kind: 'text', additions: 1, deletions: 1, truncated: false })
    expect(diff?.unifiedDiff).toContain('-antes')
    expect(diff?.unifiedDiff).toContain('+depois')
  })

  it('não expõe conteúdo binário nem arquivo grande como texto', async () => {
    const { database, workspace, executionId, checkpoints, capture } = await fixture()
    fs.writeFileSync(path.join(workspace, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
    fs.writeFileSync(path.join(workspace, 'large.txt'), 'a'.repeat(1_024 * 1_024 + 1))
    const before = await checkpoints.capture(executionId, workspace, 'before')
    fs.writeFileSync(path.join(workspace, 'binary.bin'), Buffer.from([0, 9, 8, 7]))
    fs.writeFileSync(path.join(workspace, 'large.txt'), 'b'.repeat(1_024 * 1_024 + 1))
    const result = await capture.capture(executionId, workspace, before.checkpoint.id, 'codex-command', ['binary.bin', 'large.txt'])
    const service = new ChangeDiffService(checkpoints, database.changeSets)
    const diffs = await service.list(result.changeSet.id, executionId)
    expect(diffs.map((diff) => [diff.relativePath, diff.kind, diff.truncated])).toEqual([
      ['binary.bin', 'binary', false],
      ['large.txt', 'large', true],
    ])
    expect(diffs.every((diff) => !diff.unifiedDiff.includes('\u0000'))).toBe(true)
  })
})
