import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { BuildRollbackService } from '../electron/ai/BuildRollbackService'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { WorkspaceChangeGate } from '../electron/change-control/WorkspaceChangeGate'
import { ExecutionChangeControlService } from '../electron/change-control/ExecutionChangeControlService'
import { registerAiIpc } from '../electron/ipc/registerAiIpc'
import type { SafeIpcMain } from '../electron/ipc/safeIpc'
import { IPC_CHANNELS } from '../shared/ipc/channels'

vi.mock('electron', () => ({ ipcMain: {}, dialog: { showMessageBox: async () => ({ response: 1 }) } }))

it('whole Build rollback crosses IPC, resolves the decision gate and publishes the persisted result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-rollback-boundary-'))
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace)
  const db = new LocalDatabase(root)
  try {
    const conversation = db.createConversation(workspace)
    const executionId = '00000000-0000-4000-8000-000000000092'
    db.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    const checkpoints = new CheckpointService(db.checkpoints, new WorkspaceCheckpointStore(path.join(root, 'snapshots')))
    const gate = new WorkspaceChangeGate(() => undefined)
    const changeControl = new ExecutionChangeControlService(checkpoints, new ChangeCaptureService(checkpoints, db.changeSets), gate)
    const target = path.join(workspace, 'file.txt'); fs.writeFileSync(target, 'before')
    await changeControl.begin(executionId, workspace)
    fs.writeFileSync(target, 'after')
    await changeControl.complete(executionId, workspace, 'manual')
    db.saveExecution({ ...db.getExecution(executionId)!, status: 'completed' })
    const handlers = new Map<string, Parameters<SafeIpcMain['handle']>[1]>()
    const send = vi.fn()
    registerAiIpc({ webContents: { send } } as never, {
      database: db, logger: { info: vi.fn() } as never, changeControl,
      buildRollback: new BuildRollbackService(db, new SnapshotRollbackService(checkpoints)),
      aiExecutions: {} as never, providerConfigurations: {} as never, projectIndex: {} as never, semanticRetrieval: {} as never,
      approvalDetails: new Map(), readWorkspaceContext: async () => ({ content: '', rules: '', updatedAt: '' }),
    }, { handle: (channel, handler) => { handlers.set(channel, handler) }, dispose: () => undefined })
    expect(gate.isHeld(workspace)).toBe(true)
    await handlers.get(IPC_CHANNELS.ai.rollback)!({} as never, conversation.id)
    expect(fs.readFileSync(target, 'utf8')).toBe('before')
    expect(db.getExecution(executionId)?.decision).toBe('rejected')
    expect(changeControl.hasPending(workspace)).toBe(false)
    expect(gate.isHeld(workspace)).toBe(false)
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.changeControl.changed, expect.objectContaining({ executionId }))
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
