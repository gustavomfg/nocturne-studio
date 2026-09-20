import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { LocalDatabase } from '../electron/database/Database'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { ChangeDecisionService } from '../electron/change-control/ChangeDecisionService'
import { ChangeDiffService } from '../electron/change-control/ChangeDiffService'
import { ChangeHunkService } from '../electron/change-control/ChangeHunkService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { registerChangeControlIpc } from '../electron/ipc/registerChangeControlIpc'
import type { SafeIpcMain } from '../electron/ipc/safeIpc'
import { IPC_CHANNELS } from '../shared/ipc/channels'
import { canonicalTestPath, removeTestDirectory } from './helpers/platform'

vi.mock('electron', () => ({ ipcMain: {} }))
const cleanup: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); cleanup.splice(0).reverse().forEach((fn) => fn()) })

async function fixture() {
  const root = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-decision-boundary-')))
  cleanup.push(() => removeTestDirectory(root))
  const workspace = path.join(root, 'project')
  fs.mkdirSync(workspace)
  const database = new LocalDatabase(root)
  cleanup.push(() => database.close())
  const conversation = database.createConversation(workspace)
  const executionId = '00000000-0000-4000-8000-000000000099'
  database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'completed', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: null })
  const checkpoints = new CheckpointService(database.checkpoints, new WorkspaceCheckpointStore(path.join(root, 'snapshots')))
  const target = path.join(workspace, 'file.txt')
  fs.writeFileSync(target, 'before')
  const before = await checkpoints.capture(executionId, workspace, 'before')
  fs.writeFileSync(target, 'after')
  const captured = await new ChangeCaptureService(checkpoints, database.changeSets).capture(executionId, workspace, before.checkpoint.id, 'codex-command')
  const rollback = new SnapshotRollbackService(checkpoints)
  const diffs = new ChangeDiffService(checkpoints, database.changeSets)
  const handlers = new Map<string, Parameters<SafeIpcMain['handle']>[1]>()
  const registrar: SafeIpcMain = { handle: (channel, handler) => { handlers.set(channel, handler) }, dispose: () => undefined }
  registerChangeControlIpc({ webContents: { send: vi.fn() } } as unknown as BrowserWindow, {
    database, rollback, diffs, decisions: new ChangeDecisionService(database.changeSets, rollback),
    hunks: new ChangeHunkService(checkpoints, diffs, database.changeSets), resolveExecution: () => true,
  }, registrar)
  const decide = (status: 'accepted' | 'rejected') => Promise.resolve().then(() => handlers.get(IPC_CHANNELS.changeControl.decide)!({} as IpcMainInvokeEvent, { conversationId: conversation.id, changeId: captured.changes[0].id, status }))
  const get = () => Promise.resolve().then(() => handlers.get(IPC_CHANNELS.changeControl.get)!({} as IpcMainInvokeEvent, { conversationId: conversation.id, executionId }))
  return { database, target, captured, decide, get, executionId, checkpoints, rollback, workspace }
}

it('resolve o ChangeSet capturado pela identidade da execução através do IPC', async () => {
  const value = await fixture()

  await expect(value.get()).resolves.toMatchObject({
    id: value.captured.changeSet.id,
    executionId: value.executionId,
  })
})

it('aplica a política de captura mais recente quando uma execução possui mais de um ChangeSet', async () => {
  const value = await fixture()
  const before = await value.checkpoints.capture(value.executionId, value.workspace, 'before')
  fs.writeFileSync(value.target, 'after-again')
  const second = await new ChangeCaptureService(value.checkpoints, value.database.changeSets).capture(value.executionId, value.workspace, before.checkpoint.id, 'manual')

  expect(value.database.changeSets.getByExecutionId(value.executionId)?.id).toBe(second.changeSet.id)
})

it('retorna ausência legítima quando a execução conhecida não possui ChangeSet', async () => {
  const value = await fixture()

  expect(value.database.changeSets.getByExecutionId('execution-without-capture')).toBeNull()
})

it('rejeição de decisão terminal nunca modifica bytes pelo IPC', async () => {
  const value = await fixture()
  await value.decide('accepted')
  await expect(value.decide('rejected')).rejects.toThrow()
  expect(fs.readFileSync(value.target, 'utf8')).toBe('after')
  expect(value.database.changeSets.getChange(value.captured.changes[0].id)?.status).toBe('accepted')
})

it('serializa decisões concorrentes e mantém execução, ChangeSet e bytes concordantes', async () => {
  const value = await fixture()
  const outcomes = await Promise.allSettled([value.decide('rejected'), value.decide('accepted')])
  expect(outcomes.map((item) => item.status)).toEqual(['fulfilled', 'rejected'])
  expect(fs.readFileSync(value.target, 'utf8')).toBe('before')
  expect(value.database.getExecution(value.executionId)?.decision).toBe('rejected')
  expect(value.database.changeSets.get(value.captured.changeSet.id)?.status).toBe('rejected')
})

it('não aceita bytes que mudaram desde AFTER', async () => {
  const value = await fixture()
  fs.writeFileSync(value.target, 'user')
  await expect(value.decide('accepted')).rejects.toThrow(/AFTER/)
  expect(fs.readFileSync(value.target, 'utf8')).toBe('user')
  expect(value.database.getExecution(value.executionId)?.decision).toBe('conflicted')
})

it('preserva conflito explícito quando persistir a decisão falha depois da mutação', async () => {
  const value = await fixture()
  const save = value.database.changeSets.saveDecision.bind(value.database.changeSets)
  vi.spyOn(value.database.changeSets, 'saveDecision').mockImplementationOnce(() => { throw new Error('commit failed') }).mockImplementation(save)
  await expect(value.decide('rejected')).rejects.toThrow('commit failed')
  expect(fs.readFileSync(value.target, 'utf8')).toBe('before')
  expect(value.database.getExecution(value.executionId)?.decision).toBe('conflicted')
})
