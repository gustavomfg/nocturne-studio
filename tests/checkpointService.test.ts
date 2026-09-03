import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('CheckpointService', () => {
  it('captura bytes, hashes e metadata sem depender de Git', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-checkpoint-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-checkpoint-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    const execution = {
      id: '00000000-0000-4000-8000-000000000010', workspace, conversationId: conversation.id,
      prompt: 'checkpoint', mode: 'build' as const, status: 'running' as const, decision: 'pending' as const,
      retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null,
    }
    database.createExecution(execution)
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'antes\n')
    const service = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))

    const result = await service.capture(execution.id, workspace, 'before')

    expect(result.checkpoint.status).toBe('ready')
    expect(result.files).toEqual([expect.objectContaining({ relativePath: 'file.txt', exists: true, kind: 'file', hash: expect.stringMatching(/^[a-f0-9]{64}$/) })])
    expect(await service.readContent(result.files[0])).toEqual(Buffer.from('antes\n'))
    expect(database.checkpoints.list(execution.id)).toHaveLength(1)
  })

  it('registra um caminho solicitado que ainda não existe', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-checkpoint-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-checkpoint-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    database.createExecution({
      id: '00000000-0000-4000-8000-000000000011', workspace, conversationId: conversation.id,
      prompt: 'checkpoint', mode: 'build', status: 'running', decision: 'pending', retryOf: null,
      startedAt: new Date().toISOString(), finishedAt: null, error: null,
    })
    const service = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))

    const result = await service.capture('00000000-0000-4000-8000-000000000011', workspace, 'before', ['new.txt'])

    expect(result.files[0]).toMatchObject({ relativePath: 'new.txt', exists: false, kind: 'missing' })
  })
})
