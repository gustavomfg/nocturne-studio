import type { BrowserWindow } from 'electron'
import { LocalDatabase } from '../database/Database'
import { Logger } from '../logging/Logger'
import { registerDataIpc } from './registerDataIpc'
import { registerGitIpc } from './registerGitIpc'
import { registerWorkspaceIpc } from './registerWorkspaceIpc'
import { registerConversationIpc } from './registerConversationIpc'
import { registerMemoryIpc } from './registerMemoryIpc'
import { registerArtifactIpc } from './registerArtifactIpc'
import { registerSuggestionIpc } from './registerSuggestionIpc'
import { safeIpcMain } from './safeIpc'
import { registerClipboardIpc } from './registerClipboardIpc'
import { getAuthorizedConversation, getAuthorizedWorkspace } from './conversationAccess'
import { registerProviderIpc, type ProviderConfigurationOperations } from './registerProviderIpc'
import { registerModelIpc, type ModelCatalogOperations } from './registerModelIpc'
import { ModelRegistry } from '../ai/ModelRegistry'
import { ProviderRegistry } from '../ai/ProviderRegistry'
import { AiExecutionCoordinator } from '../ai/AiExecutionCoordinator'
import { persistCompletedTurn } from '../ai/TurnPersistence'
import { CodexAccountService } from '../codex/CodexAccountService'
import { BuildRollbackService } from '../ai/BuildRollbackService'
import { DocumentUpdateService } from '../documents/DocumentUpdateService'
import { registerCodexIpc } from './registerCodexIpc'
import { registerFilesIpc } from './registerFilesIpc'
import { registerDiagnosticsIpc } from './registerDiagnosticsIpc'
import { registerAiIpc } from './registerAiIpc'
import { registerSettingsIpc } from './registerSettingsIpc'
import { registerDocumentsIpc } from './registerDocumentsIpc'
import { ensureNocturneWorkspace, readWorkspaceContext, recordSuggestionDecision, runWorkspaceCommand, writeWorkspaceContext } from '../workspaces/WorkspaceContextService'

export function registerIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  logger: Logger,
  providerConfigurations: ProviderConfigurationOperations,
  modelCatalog: ModelCatalogOperations,
  modelRegistry: ModelRegistry,
  providerRegistry: ProviderRegistry,
) {
  const ipcMain = safeIpcMain(win, {
    onCompleted: ({ channel, durationMs, failed }) => {
      const details = { channel, durationMs, failed }
      if (failed || durationMs >= 100) logger.warn('ipc', 'Operação IPC concluída com atenção.', details)
      else logger.debug('ipc', 'Operação IPC concluída.', details)
    },
  })
  const disposeData = registerDataIpc(win, database, logger, ipcMain)
  const disposeGit = registerGitIpc(win, database, ipcMain)
  const disposeWorkspace = registerWorkspaceIpc(
    win,
    database,
    {
      ensureWorkspace: ensureNocturneWorkspace,
      assertKnownWorkspace: (value) => getAuthorizedWorkspace(database, value),
      run: runWorkspaceCommand,
    },
    ipcMain,
  )
  const disposeConversation = registerConversationIpc(
    win,
    database,
    {
      ensureWorkspace: ensureNocturneWorkspace,
      assertKnownWorkspace: (value) => getAuthorizedWorkspace(database, value),
    },
    ipcMain,
  )
  const knowledgeDependencies = {
    authorizedWorkspace: (id: string) => getAuthorizedConversation(database, id).workspace,
  }
  const disposeMemory = registerMemoryIpc(
    win,
    database,
    logger,
    {
      ...knowledgeDependencies,
      read: readWorkspaceContext,
      write: writeWorkspaceContext,
    },
    ipcMain,
  )
  const disposeArtifacts = registerArtifactIpc(
    win,
    database,
    knowledgeDependencies,
    ipcMain,
  )
  const disposeSuggestions = registerSuggestionIpc(
    win,
    database,
    logger,
    {
      ...knowledgeDependencies,
      recordDecision: recordSuggestionDecision,
    },
    ipcMain,
  )
  const disposeProviders = registerProviderIpc(win, providerConfigurations, ipcMain)
  const disposeModels = registerModelIpc(win, database, modelCatalog, ipcMain)
  const disposeClipboard = registerClipboardIpc(win, ipcMain)

  const approvalDetails = new Map<string, { command?: string; risk?: string }>()
  const buildRollback = new BuildRollbackService()
  const documentUpdates = new DocumentUpdateService()
  const codexAccount = new CodexAccountService()
  const aiExecutions = new AiExecutionCoordinator(
    win,
    modelRegistry,
    providerRegistry,
    logger,
    approvalDetails,
    (snapshot) => {
      const persisted = persistCompletedTurn(database, snapshot)
      if (snapshot.mode === 'build') buildRollback.complete(snapshot.conversationId, snapshot.files)
      return persisted
    },
    (conversationId, threadId) => database.setConversationCodexThread(conversationId, threadId),
  )

  const disposeCodex = registerCodexIpc(win, codexAccount, aiExecutions, ipcMain)
  const disposeFiles = registerFilesIpc(win, database, ipcMain)
  const disposeDiagnostics = registerDiagnosticsIpc(win, logger, providerConfigurations, modelRegistry, ipcMain)
  const disposeAi = registerAiIpc(
    win,
    {
      database,
      logger,
      providerConfigurations,
      aiExecutions,
      buildRollback,
      approvalDetails,
      readWorkspaceContext,
    },
    ipcMain,
  )
  const disposeSettings = registerSettingsIpc(win, database, logger, ipcMain)
  const disposeDocuments = registerDocumentsIpc(win, database, documentUpdates, ipcMain)

  return () => {
    aiExecutions.dispose()
    ipcMain.dispose()
    return Promise.all([
      disposeWorkspace(),
      disposeConversation(),
      disposeMemory(),
      disposeArtifacts(),
      disposeSuggestions(),
      disposeGit(),
      disposeData(),
      disposeProviders(),
      disposeModels(),
      disposeClipboard(),
      disposeCodex(),
      disposeFiles(),
      disposeDiagnostics(),
      disposeAi(),
      disposeSettings(),
      disposeDocuments(),
    ]).then(() => undefined)
  }
}
