import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { BuildRollbackService } from '../electron/ai/BuildRollbackService'
import { LocalDatabase } from '../electron/database/Database'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { closeNativeRollbackOperations, protectedRollbackSupported } from '../electron/change-control/NativeRollbackOperation'
import { canonicalTestPath, removeTestDirectoryAsync } from './helpers/platform'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

it.runIf(protectedRollbackSupported()).each(['root', 'shutdown'])('retains root authority and admission epoch across whole-Build decisions: %s', async (interference) => {
  const base = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-build-root-')))
  cleanup.push(() => removeTestDirectoryAsync(base))
  const workspace = path.join(base, 'project')
  fs.mkdirSync(workspace)
  const database = new LocalDatabase(base)
  cleanup.push(() => database.close())
  const conversation = database.createConversation(workspace)
  const executionId = 'root-bound-build'
  const now = new Date().toISOString()
  database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'completed', decision: 'pending', retryOf: null, startedAt: now, finishedAt: now, error: null })
  const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(base, 'snapshots')))
  for (const name of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(workspace, name), 'BEFORE')
  const before = await checkpoints.capture(executionId, workspace, 'before')
  for (const name of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(workspace, name), 'AFTER')
  await new ChangeCaptureService(checkpoints, database.changeSets).capture(executionId, workspace, before.checkpoint.id, 'manual')
  const save = database.changeSets.saveDecision.bind(database.changeSets)
  let swapped = false
  let shutdown: Promise<void> | undefined
  vi.spyOn(database.changeSets, 'saveDecision').mockImplementation((...args: Parameters<typeof save>) => {
    const result = save(...args)
    if (!swapped && args[1].relativePath === 'a.txt' && args[1].status === 'rejected') {
      swapped = true
      if (interference === 'root') execFileSync(process.execPath, ['-e', 'const fs=require("node:fs"),p=require("node:path");const w=process.argv[1];fs.renameSync(w,w+"-retained");fs.mkdirSync(w);for(const n of ["a.txt","b.txt"])fs.writeFileSync(p.join(w,n),"AFTER")', workspace], { shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      else shutdown = closeNativeRollbackOperations()
    }
    return result
  })
  const service = new BuildRollbackService(database, new SnapshotRollbackService(checkpoints))
  await expect(service.rollback(conversation.id, workspace)).rejects.toThrow(/REVOKED/)
  await shutdown
  expect(swapped).toBe(true)
  if (interference === 'root') {
    for (const name of ['a.txt', 'b.txt']) expect(fs.readFileSync(path.join(workspace, name), 'utf8')).toBe('AFTER')
    expect(fs.readFileSync(path.join(`${workspace}-retained`, 'a.txt'), 'utf8')).toBe('BEFORE')
    expect(fs.readFileSync(path.join(`${workspace}-retained`, 'b.txt'), 'utf8')).toBe('AFTER')
  } else {
    expect(fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8')).toBe('BEFORE')
    expect(fs.readFileSync(path.join(workspace, 'b.txt'), 'utf8')).toBe('AFTER')
  }
  expect(database.getExecution(executionId)?.decision).toBe('conflicted')
})

it.runIf(protectedRollbackSupported())('usa BEFORE imutável com HEAD alterado e recusa edição posterior ao AFTER', async () => {
  const root = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-build-invariant-')))
  cleanup.push(() => removeTestDirectoryAsync(root))
  const workspace = path.join(root, 'project')
  fs.mkdirSync(workspace)
  const database = new LocalDatabase(root)
  cleanup.push(() => database.close())
  const conversation = database.createConversation(workspace)
  const executionId = 'rollback-execution'
  database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'completed', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: null })
  const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(root, 'snapshots')))
  const target = path.join(workspace, 'file.txt')
  fs.writeFileSync(target, 'before')
  const before = await checkpoints.capture(executionId, workspace, 'before')
  fs.writeFileSync(target, 'after')
  await new ChangeCaptureService(checkpoints, database.changeSets).capture(executionId, workspace, before.checkpoint.id, 'codex-command')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' })
  git('init')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('add', 'file.txt')
  git('commit', '-m', 'after')
  const service = new BuildRollbackService(database, new SnapshotRollbackService(checkpoints))
  await expect(service.rollback(conversation.id, workspace, 'different-execution')).rejects.toThrow(/Build mudou/)
  expect(fs.readFileSync(target, 'utf8')).toBe('after')
  fs.writeFileSync(target, 'user')
  await expect(service.rollback(conversation.id, workspace)).rejects.toThrow(/conflito/)
  expect(fs.readFileSync(target, 'utf8')).toBe('user')
  fs.writeFileSync(target, 'after')
  await service.rollback(conversation.id, workspace)
  expect(fs.readFileSync(target, 'utf8')).toBe('before')
})
