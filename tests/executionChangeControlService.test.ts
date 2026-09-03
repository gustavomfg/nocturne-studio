import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { ExecutionChangeControlService } from '../electron/change-control/ExecutionChangeControlService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ExecutionChangeControlService', () => {
  it('captura a janela de uma execução e mantém a captura idempotente', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-control-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-control-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    const executionId = '00000000-0000-4000-8000-000000000060'
    database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'control', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'antes\n')
    const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))
    const control = new ExecutionChangeControlService(checkpoints, new ChangeCaptureService(checkpoints, database.changeSets))

    const before = await control.begin(executionId, workspace)
    expect(before.phase).toBe('before')
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'depois\n')
    const captured = await control.complete(executionId, workspace, 'codex-command')

    expect(captured?.changeSet.executionId).toBe(executionId)
    expect(captured?.changes[0]).toMatchObject({ relativePath: 'file.txt', origin: 'codex-command' })
    expect(control.before(executionId)).toBeNull()
    expect(await control.complete(executionId, workspace, 'codex-command')).toBeNull()
  })
})
