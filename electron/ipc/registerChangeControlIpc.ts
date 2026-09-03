import type { BrowserWindow } from 'electron'
import { changeControlChangeSchema, changeControlDecisionSchema, changeControlExecutionSchema, changeControlHunkDecisionSchema, changeControlHunkEditSchema, changeControlSetSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { ChangeDiffService } from '../change-control/ChangeDiffService'
import type { ChangeDecisionService } from '../change-control/ChangeDecisionService'
import type { ChangeHunkService } from '../change-control/ChangeHunkService'
import type { LocalDatabase } from '../database/Database'
import { getAuthorizedConversation } from './conversationAccess'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  database: LocalDatabase
  diffs: ChangeDiffService
  decisions: ChangeDecisionService
  hunks: ChangeHunkService
}

/** Exposes bounded ChangeSet reads and explicit decisions to the renderer. */
export function registerChangeControlIpc(win: BrowserWindow, dependencies: Dependencies, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const execution = (value: unknown) => {
    const data = changeControlExecutionSchema.parse(value)
    const conversation = getAuthorizedConversation(dependencies.database, data.conversationId)
    const record = dependencies.database.getExecution(data.executionId, conversation.workspace)
    if (!record || record.conversationId !== conversation.id) throw new Error('A execução não pertence à conversa autorizada.')
    return { data, record }
  }
  const change = (value: unknown) => {
    const data = changeControlChangeSchema.parse(value)
    const conversation = getAuthorizedConversation(dependencies.database, data.conversationId)
    return { data, conversation }
  }

  ipcMain.handle(IPC_CHANNELS.changeControl.get, (_event, value: unknown) => {
    const { data } = execution(value)
    return dependencies.database.changeSets.get(data.executionId)
  })
  ipcMain.handle(IPC_CHANNELS.changeControl.changes, (_event, value: unknown) => {
    const data = changeControlSetSchema.parse(value)
    const conversation = getAuthorizedConversation(dependencies.database, data.conversationId)
    const changeSet = dependencies.database.changeSets.get(data.changeSetId)
    if (!changeSet) return []
    const record = dependencies.database.getExecution(changeSet.executionId, conversation.workspace)
    if (!record || record.conversationId !== conversation.id) throw new Error('O ChangeSet não pertence à conversa autorizada.')
    return dependencies.database.changeSets.listChanges(data.changeSetId)
  })
  ipcMain.handle(IPC_CHANNELS.changeControl.diff, async (_event, value: unknown) => {
    const { data, conversation } = change(value)
    const record = dependencies.database.changeSets.get(dependencies.database.changeSets.getChange(data.changeId)?.changeSetId ?? '')
    const executionRecord = record ? dependencies.database.getExecution(record.executionId, conversation.workspace) : null
    if (!executionRecord || executionRecord.conversationId !== conversation.id) throw new Error('A mudança não pertence à conversa autorizada.')
    return dependencies.diffs.get(data.changeId, executionRecord.id)
  })
  ipcMain.handle(IPC_CHANNELS.changeControl.hunks, (_event, value: unknown) => {
    const { data, conversation } = change(value)
    const persisted = dependencies.database.changeSets.getChange(data.changeId)
    const executionRecord = persisted ? dependencies.database.getExecution(persisted.executionId, conversation.workspace) : null
    if (!executionRecord || executionRecord.conversationId !== conversation.id) throw new Error('Os hunks não pertencem à conversa autorizada.')
    return dependencies.hunks.list(data.changeId, executionRecord.id)
  })
  ipcMain.handle(IPC_CHANNELS.changeControl.editHunk, async (_event, value: unknown) => {
    const data = changeControlHunkEditSchema.parse(value)
    const conversation = getAuthorizedConversation(dependencies.database, data.conversationId)
    const persisted = dependencies.database.changeSets.getHunk(data.hunkId)
    const change = persisted ? dependencies.database.changeSets.getChange(persisted.changeId) : null
    const executionRecord = change ? dependencies.database.getExecution(change.executionId, conversation.workspace) : null
    if (!change || !executionRecord || executionRecord.conversationId !== conversation.id) throw new Error('O hunk não pertence à conversa autorizada.')
    const updated = await dependencies.hunks.edit(data.hunkId, data.finalPatch, executionRecord.id)
    win.webContents.send(IPC_CHANNELS.changeControl.changed, { executionId: executionRecord.id, changeSetId: change.changeSetId })
    return updated
  })
  ipcMain.handle(IPC_CHANNELS.changeControl.decideHunk, (_event, value: unknown) => {
    const data = changeControlHunkDecisionSchema.parse(value)
    const conversation = getAuthorizedConversation(dependencies.database, data.conversationId)
    const hunk = dependencies.database.changeSets.getHunk(data.hunkId)
    const change = hunk ? dependencies.database.changeSets.getChange(hunk.changeId) : null
    const executionRecord = change ? dependencies.database.getExecution(change.executionId, conversation.workspace) : null
    if (!executionRecord || executionRecord.conversationId !== conversation.id) throw new Error('O hunk não pertence à conversa autorizada.')
    return dependencies.hunks.decide(data.hunkId, data.status, executionRecord.id)
  })
  ipcMain.handle(IPC_CHANNELS.changeControl.decide, (_event, value: unknown) => {
    const data = changeControlDecisionSchema.parse(value)
    const conversation = getAuthorizedConversation(dependencies.database, data.conversationId)
    const persisted = dependencies.database.changeSets.getChange(data.changeId)
    const executionRecord = persisted ? dependencies.database.getExecution(persisted.executionId, conversation.workspace) : null
    if (!executionRecord || executionRecord.conversationId !== conversation.id) throw new Error('A mudança não pertence à conversa autorizada.')
    const result = dependencies.decisions.decide(executionRecord.id, data.changeId, data.status)
    win.webContents.send(IPC_CHANNELS.changeControl.changed, { executionId: executionRecord.id, changeSetId: result.changeSet.id })
    return result
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}
