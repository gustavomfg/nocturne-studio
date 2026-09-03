import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ChangeCaptureService', () => {
  it('registra create, modify e delete com hashes e origem', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-changes-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-changes-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    const executionId = '00000000-0000-4000-8000-000000000030'
    database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'changes', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    fs.writeFileSync(path.join(workspace, 'modified.txt'), 'antes\n')
    fs.writeFileSync(path.join(workspace, 'deleted.txt'), 'remover\n')
    const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))
    const service = new ChangeCaptureService(checkpoints, database.changeSets)
    const before = await checkpoints.capture(executionId, workspace, 'before')
    fs.writeFileSync(path.join(workspace, 'modified.txt'), 'depois\n')
    fs.unlinkSync(path.join(workspace, 'deleted.txt'))
    fs.writeFileSync(path.join(workspace, 'created.txt'), 'novo\n')

    const result = await service.capture(executionId, workspace, before.checkpoint.id, 'codex-command', ['modified.txt', 'deleted.txt', 'created.txt'])

    expect(result.changeSet.status).toBe('pending')
    expect(result.changes.map((change) => [change.relativePath, change.operation, change.origin])).toEqual([
      ['created.txt', 'create', 'codex-command'],
      ['deleted.txt', 'delete', 'codex-command'],
      ['modified.txt', 'modify', 'codex-command'],
    ])
    expect(database.changeSets.listChanges(result.changeSet.id)).toHaveLength(3)
  })
})
