import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  vi.restoreAllMocks()
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
  it('reverte delete e rename como operações de bytes sem depender de Git', async () => {
    const value = await fixture()
    fs.writeFileSync(path.join(value.workspace, 'deleted.txt'), 'deleted before')
    fs.writeFileSync(path.join(value.workspace, 'old.txt'), 'renamed before')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.unlinkSync(path.join(value.workspace, 'deleted.txt'))
    fs.renameSync(path.join(value.workspace, 'old.txt'), path.join(value.workspace, 'new.txt'))
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
    expect(result.status).toBe('restored')
    expect(fs.readFileSync(path.join(value.workspace, 'old.txt'), 'utf8')).toBe('renamed before')
    expect(fs.readFileSync(path.join(value.workspace, 'deleted.txt'), 'utf8')).toBe('deleted before')
    expect(fs.existsSync(path.join(value.workspace, 'new.txt'))).toBe(false)
  })

  it.each([true, false])('não substitui arquivo criado por outro processo durante a publicação (before existe: %s)', async (existedBefore) => {
    const value = await fixture()
    const target = path.join(value.workspace, 'file.txt')
    if (existedBefore) fs.writeFileSync(target, 'before')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(target, 'after')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    const rename = fs.promises.rename.bind(fs.promises)
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
      await rename(source, destination)
      if (source === target) fs.writeFileSync(target, 'concurrent replacement')
    })
    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
    expect(result.status).toBe('conflicted')
    expect(fs.readFileSync(target, 'utf8')).toBe('concurrent replacement')
    expect(result.recoveryDirectory).toBeTruthy()
  })

  it('registra rollback parcial e preserva os dois estados ao interromper a segunda restauração', async () => {
    const value = await fixture()
    for (const name of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(value.workspace, name), 'before')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    for (const name of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(value.workspace, name), 'after')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    const read = value.checkpoints.readContent.bind(value.checkpoints)
    vi.spyOn(value.checkpoints, 'readContent').mockImplementation(async (file) => {
      if (file.relativePath === 'b.txt') throw new Error('filesystem unavailable')
      return read(file)
    })
    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
    expect(result).toMatchObject({ status: 'conflicted', restored: ['a.txt'], conflicts: ['b.txt'] })
    expect(fs.readFileSync(path.join(value.workspace, 'a.txt'), 'utf8')).toBe('before')
    expect(fs.readFileSync(path.join(value.workspace, 'b.txt'), 'utf8')).toBe('after')
    expect(JSON.parse(fs.readFileSync(path.join(result.recoveryDirectory!, 'operation.json'), 'utf8'))).toMatchObject({ status: 'conflicted', restored: ['a.txt'] })
  })

  it('preserva edição externa feita depois da verificação inicial do rollback', async () => {
    const value = await fixture()
    const target = path.join(value.workspace, 'tracked.txt')
    fs.writeFileSync(target, 'antes\n')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(target, 'agente\n')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    const read = value.checkpoints.readContent.bind(value.checkpoints)
    vi.spyOn(value.checkpoints, 'readContent').mockImplementation(async (file) => {
      const content = await read(file)
      fs.writeFileSync(target, 'trabalho posterior\n')
      return content
    })

    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)

    expect(result.status).toBe('conflicted')
    expect(fs.readFileSync(target, 'utf8')).toBe('trabalho posterior\n')
  })

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

  it('restaura apenas o caminho rejeitado quando o restante da execução deve permanecer', async () => {
    const value = await fixture()
    fs.writeFileSync(path.join(value.workspace, 'keep.txt'), 'antes keep\n')
    fs.writeFileSync(path.join(value.workspace, 'reject.txt'), 'antes reject\n')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(path.join(value.workspace, 'keep.txt'), 'depois keep\n')
    fs.writeFileSync(path.join(value.workspace, 'reject.txt'), 'depois reject\n')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after', ['keep.txt', 'reject.txt'])

    const result = await value.rollback.rollbackPaths(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id, ['reject.txt'])

    expect(result).toEqual({ status: 'restored', restored: ['reject.txt'], conflicts: [] })
    expect(fs.readFileSync(path.join(value.workspace, 'keep.txt'), 'utf8')).toBe('depois keep\n')
    expect(fs.readFileSync(path.join(value.workspace, 'reject.txt'), 'utf8')).toBe('antes reject\n')
  })
})
