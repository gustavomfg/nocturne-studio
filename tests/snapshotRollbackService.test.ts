import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

async function fixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-rollback-db-'))
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-rollback-project-'))
  directories.push(userData, workspace)
  const database = new LocalDatabase(userData)
  databases.push(database)
  const conversation = database.createConversation(workspace)
  const executionId = '00000000-0000-4000-8000-000000000020'
  database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'rollback', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
  const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))
  return { database, workspace, executionId, checkpoints, rollback: new SnapshotRollbackService(checkpoints) }
}

describe('SnapshotRollbackService', () => {
  it('restaura estado anterior sem exigir Git', async () => {
    const value = await fixture()
    fs.writeFileSync(path.join(value.workspace, 'tracked.txt'), 'antes\n')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(path.join(value.workspace, 'tracked.txt'), 'depois\n')
    fs.writeFileSync(path.join(value.workspace, 'created.txt'), 'novo\n')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after', ['tracked.txt', 'created.txt'])

    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)

    expect(result).toEqual({ status: 'restored', restored: ['created.txt', 'tracked.txt'], conflicts: [] })
    expect(fs.readFileSync(path.join(value.workspace, 'tracked.txt'), 'utf8')).toBe('antes\n')
    expect(fs.existsSync(path.join(value.workspace, 'created.txt'))).toBe(false)
  })

  it('detecta alteração externa e não sobrescreve o estado atual', async () => {
    const value = await fixture()
    fs.writeFileSync(path.join(value.workspace, 'tracked.txt'), 'antes\n')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(path.join(value.workspace, 'tracked.txt'), 'agente\n')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after', ['tracked.txt'])
    fs.writeFileSync(path.join(value.workspace, 'tracked.txt'), 'usuário\n')

    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)

    expect(result).toEqual({ status: 'conflicted', restored: [], conflicts: ['tracked.txt'] })
    expect(fs.readFileSync(path.join(value.workspace, 'tracked.txt'), 'utf8')).toBe('usuário\n')
  })
})
