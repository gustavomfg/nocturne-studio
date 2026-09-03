import type { BrowserWindow } from 'electron'
import { changeControlChangeSchema, changeControlDecisionSchema, changeControlExecutionSchema, changeControlSetSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { ChangeDiffService } from '../change-control/ChangeDiffService'
import type { ChangeDecisionService } from '../change-control/ChangeDecisionService'
import type { LocalDatabase } from '../database/Database'
import { getAuthorizedConversation } from './conversationAccess'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

interface Dependencies {
  database: LocalDatabase
  diffs: ChangeDiffService
  decisions: ChangeDecisionService
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
