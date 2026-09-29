import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { LocalDatabase } from '../electron/database/Database'
import { NativeRollbackOperation, closeNativeRollbackOperations } from '../electron/change-control/NativeRollbackOperation'
import { canonicalTestPath, removeTestDirectory } from './helpers/platform'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) removeTestDirectory(directory)
})

async function fixture() {
  const userData = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-rollback-db-')))
  const workspace = canonicalTestPath(fs.mkdtempSync(path.join(process.env.NOCTURNE_NATIVE_TEST_ROOT ?? os.tmpdir(), 'nocturne-rollback-project-')))
  directories.push(userData, workspace)
  const database = new LocalDatabase(userData)
  databases.push(database)
  const conversation = database.createConversation(workspace)
  const executionId = '00000000-0000-4000-8000-000000000020'
  database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'rollback', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
  const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(userData, 'snapshots')))
  return { database, workspace, executionId, checkpoints, rollback: new SnapshotRollbackService(checkpoints) }
}

it('disposed rollback owners reject late requests without starting filesystem work', async () => {
  const value = await fixture()
  const target = path.join(value.workspace, 'target.txt')
  fs.writeFileSync(target, 'BEFORE')
  const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
  fs.writeFileSync(target, 'AFTER')
  const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
  value.rollback.dispose()
  await expect(value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)).rejects.toThrow(/REVOKED/)
  await expect(value.rollback.verifyPaths(value.executionId, value.workspace, after.checkpoint.id, ['target.txt'])).rejects.toThrow(/REVOKED/)
  expect(fs.readFileSync(target, 'utf8')).toBe('AFTER')
})

describe.runIf(process.platform === 'linux')('SnapshotRollbackService protected mutations', () => {
  it('does not admit a helper after shutdown overtakes asynchronous rollback preparation', async () => {
    const value = await fixture()
    const target = path.join(value.workspace, 'target.txt')
    fs.writeFileSync(target, 'BEFORE')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(target, 'AFTER')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    const read = fs.promises.readFile.bind(fs.promises)
    let shutdown = false
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.promises.readFile>) => {
      const bytes = await read(...args)
      if (!shutdown && args[0] === target) { shutdown = true; await closeNativeRollbackOperations() }
      return bytes
    })
    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
    expect(shutdown).toBe(true)
    expect(result).toMatchObject({ status: 'conflicted', restored: [], boundaryOutcome: 'REVOKED' })
    expect(fs.readFileSync(target, 'utf8')).toBe('AFTER')
    expect(fs.readdirSync(value.workspace)).toEqual(['target.txt'])
  })

  it('does not authorize a replacement root after the rollback preflight has started', async () => {
    const value = await fixture()
    const target = path.join(value.workspace, 'target.txt')
    fs.writeFileSync(target, 'BEFORE')
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(target, 'AFTER')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    directories.push(`${value.workspace}-retained`)
    const read = fs.promises.readFile.bind(fs.promises)
    let replaced = false
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.promises.readFile>) => {
      const result = await read(...args)
      if (!replaced && args[0] === target) {
        replaced = true
        const peer = spawnSync(process.execPath, ['-e', 'const fs=require("node:fs"),path=require("node:path");const p=process.argv[1];fs.renameSync(p,p+"-retained");fs.mkdirSync(p);fs.writeFileSync(path.join(p,"target.txt"),"AFTER")', value.workspace], { shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
        expect(peer.status).toBe(0)
      }
      return result
    })
    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
    expect(replaced).toBe(true)
    expect(result).toMatchObject({ status: 'conflicted', restored: [], boundaryOutcome: 'REVOKED' })
    expect(fs.readFileSync(target, 'utf8')).toBe('AFTER')
    expect(fs.readFileSync(path.join(`${value.workspace}-retained`, 'target.txt'), 'utf8')).toBe('AFTER')
  })

  it('revokes the real rollback after an external parent swap; preserves external bytes and journal truth', async () => {
    const value = await fixture()
    const parent = path.join(value.workspace, 'parent')
    const outside = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-rollback-outside-')))
    directories.push(outside)
    fs.mkdirSync(parent)
    fs.writeFileSync(path.join(parent, 'target.txt'), 'BEFORE')
    fs.writeFileSync(path.join(outside, 'target.txt'), 'PROTECTED')
    const outsideIdentity = fs.statSync(path.join(outside, 'target.txt')).ino
    const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
    fs.writeFileSync(path.join(parent, 'target.txt'), 'AFTER')
    const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
    const stage = NativeRollbackOperation.prototype.stage
    vi.spyOn(NativeRollbackOperation.prototype, 'stage').mockImplementation(async function (this: NativeRollbackOperation, bytes, mode) {
      const result = await stage.call(this, bytes, mode)
      const peer = spawnSync(process.execPath, ['-e', 'const fs=require("node:fs");const [p,o]=process.argv.slice(1);fs.renameSync(p,p+"-retained");fs.symlinkSync(o,p,"dir")', parent, outside], { shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      expect(peer.status).toBe(0)
      return result
    })
    const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
    expect(result).toMatchObject({ status: 'conflicted', restored: [], boundaryOutcome: 'REVOKED' })
    expect(fs.readFileSync(path.join(outside, 'target.txt'), 'utf8')).toBe('PROTECTED')
    expect(fs.statSync(path.join(outside, 'target.txt')).ino).toBe(outsideIdentity)
    expect(fs.readdirSync(outside)).toEqual(['target.txt'])
    expect(fs.readFileSync(path.join(value.workspace, 'parent-retained', 'target.txt'), 'utf8')).toBe('AFTER')
    expect(JSON.parse(fs.readFileSync(path.join(result.recoveryDirectory!, 'operation.json'), 'utf8'))).toMatchObject({ status: 'conflicted', outcome: 'REVOKED', restored: [] })
  })
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
    const displace = NativeRollbackOperation.prototype.displace
    vi.spyOn(NativeRollbackOperation.prototype, 'displace').mockImplementation(async function (this: NativeRollbackOperation, entry) {
      const result = await displace.call(this, entry)
      fs.writeFileSync(target, 'concurrent replacement')
      return result
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

it.runIf(process.platform !== 'linux')('unimplemented protected rollback is explicit and leaves BEFORE/AFTER and current bytes intact', async () => {
  const value = await fixture()
  const target = path.join(value.workspace, 'target.txt')
  fs.writeFileSync(target, 'BEFORE')
  const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
  fs.writeFileSync(target, 'AFTER')
  const after = await value.checkpoints.capture(value.executionId, value.workspace, 'after')
  const result = await value.rollback.rollback(value.executionId, value.workspace, before.checkpoint.id, after.checkpoint.id)
  expect(result).toMatchObject({ status: 'conflicted', restored: [], boundaryOutcome: 'UNSUPPORTED' })
  expect(fs.readFileSync(target, 'utf8')).toBe('AFTER')
  expect(value.checkpoints.get(before.checkpoint.id, value.executionId)?.status).toBe('ready')
  expect(value.checkpoints.get(after.checkpoint.id, value.executionId)?.status).toBe('ready')
})
