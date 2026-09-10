import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BuildRollbackService } from '../electron/ai/BuildRollbackService'
import { LocalDatabase } from '../electron/database/Database'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).reverse().forEach((fn) => fn()))

it('usa BEFORE imutável com HEAD alterado e recusa edição posterior ao AFTER', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-build-invariant-'))
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
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
  fs.writeFileSync(target, 'user')
  await expect(service.rollback(conversation.id, workspace)).rejects.toThrow(/conflito/)
  expect(fs.readFileSync(target, 'utf8')).toBe('user')
  fs.writeFileSync(target, 'after')
  await service.rollback(conversation.id, workspace)
  expect(fs.readFileSync(target, 'utf8')).toBe('before')
})
