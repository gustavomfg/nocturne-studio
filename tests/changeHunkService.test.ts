import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { ChangeDiffService } from '../electron/change-control/ChangeDiffService'
import { ChangeHunkService } from '../electron/change-control/ChangeHunkService'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ChangeHunkService', () => {
  it('cria hunk, aceita edição válida e marca patch incompatível como conflito', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-hunk-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-hunk-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    const executionId = '00000000-0000-4000-8000-000000000070'
    database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'hunk', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'antes\n')
    const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))
    const capture = new ChangeCaptureService(checkpoints, database.changeSets)
    const before = await checkpoints.capture(executionId, workspace, 'before')
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'depois\n')
    const result = await capture.capture(executionId, workspace, before.checkpoint.id, 'codex-command', ['file.txt'])
    const service = new ChangeHunkService(checkpoints, new ChangeDiffService(checkpoints, database.changeSets), database.changeSets)
    const [hunk] = await service.list(result.changes[0].id, executionId)
    expect(hunk.status).toBe('pending')
    const edited = await service.edit(hunk.id, hunk.finalPatch.replace('+depois', '+revisado'), executionId)
    expect(edited.status).toBe('edited')
    await expect(service.edit(hunk.id, hunk.finalPatch.replace('-antes', '-não existe'), executionId)).resolves.toMatchObject({ status: 'conflicted' })
  })
})
