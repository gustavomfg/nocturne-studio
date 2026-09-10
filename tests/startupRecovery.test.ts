import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { WorkspaceChangeGate } from '../electron/change-control/WorkspaceChangeGate'
import { ExecutionChangeControlService } from '../electron/change-control/ExecutionChangeControlService'
import { LocalDatabase } from '../electron/database/Database'

it('reconciles a durable running execution on reopen without resuming it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-'))
  let db = new LocalDatabase(root)
  try {
    const conversation = db.createConversation(root)
    db.createExecution({ id: 'interrupted', workspace: root, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    db.close()
    db = new LocalDatabase(root)
    expect(db.getExecution('interrupted')).toMatchObject({ status: 'failed', error: expect.stringContaining('interrompida') })
    expect(db.operationRecovery.list()).toEqual([expect.objectContaining({ kind: 'execution', originalStatus: 'running' })])
    const records = db.operationRecovery.list()
    db.close(); db = new LocalDatabase(root)
    expect(db.operationRecovery.list()).toEqual(records)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

it('recovers interrupted decisions and captures without touching workspace bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-decision-'))
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace)
  let db = new LocalDatabase(root)
  try {
    const conversation = db.createConversation(workspace)
    db.createExecution({ id: 'build', workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'completed', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    const checkpoints = new CheckpointService(db.checkpoints, new WorkspaceCheckpointStore(path.join(root, 'snapshots')))
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'before')
    const before = await checkpoints.capture('build', workspace, 'before')
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'after')
    const captured = await new ChangeCaptureService(checkpoints, db.changeSets).capture('build', workspace, before.checkpoint.id, 'manual')
    db.changeSets.reserveDecision('build', captured.changes[0].id, 'rejected')
    db.checkpoints.create({ ...before.checkpoint, id: 'unfinished-capture', status: 'capturing' })
    db.validation.create({ id: 'validation', workspace, executionId: 'build', kind: 'test', command: 'test', args: [], status: 'running', exitCode: null, durationMs: null, outputSummary: '', artifacts: [], startedAt: new Date().toISOString(), completedAt: null, error: null })
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'partially-restored-or-user-edit')
    db.close(); db = new LocalDatabase(root)
    expect(db.getExecution('build')).toMatchObject({ status: 'completed', decision: 'conflicted' })
    expect(db.checkpoints.get('unfinished-capture')?.status).toBe('failed')
    expect(db.validation.latest(workspace)?.status).toBe('failed')
    expect(db.changeSets.getChange(captured.changes[0].id)?.status).toBe('conflicted')
    expect(db.operationRecovery.list().map((entry) => entry.kind).sort()).toEqual(['awaiting-decision', 'checkpoint', 'decision', 'validation'])
    const gate = new WorkspaceChangeGate(() => undefined)
    const service = new ExecutionChangeControlService(checkpoints, new ChangeCaptureService(checkpoints, db.changeSets), gate)
    service.restorePending(db.operationRecovery.pendingDecisions())
    expect(service.hasPending(workspace)).toBe(true)
    expect(gate.isHeld(workspace)).toBe(true)
    expect(fs.readFileSync(path.join(workspace, 'file.txt'), 'utf8')).toBe('partially-restored-or-user-edit')
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
