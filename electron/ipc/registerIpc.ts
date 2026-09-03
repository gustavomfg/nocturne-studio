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
import { isTerminalAgentState, type AgentRunState } from '../../shared/agentLifecycle'
import { registerSettingsIpc } from './registerSettingsIpc'
import { registerDocumentsIpc } from './registerDocumentsIpc'
import { registerProjectIndexIpc } from './registerProjectIndexIpc'
import { registerValidationIpc } from './registerValidationIpc'
import { ensureNocturneWorkspace, readWorkspaceContext, recordSuggestionDecision, runWorkspaceCommand, writeWorkspaceContext } from '../workspaces/WorkspaceContextService'
import { ProjectIndexService } from '../project-index/ProjectIndexService'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { ValidationPipeline } from '../validation/ValidationPipeline'

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
  const projectIndex = new ProjectIndexService(database.projectIndex, {
    onStatus: (status) => win.webContents.send(IPC_CHANNELS.projectIndex.changed, status),
    onMetric: (metric) => logger.info('index', 'Métrica de indexação concluída.', {
      runId: metric.runId,
      runKind: metric.runKind,
      durationMs: metric.durationMs,
      processedFiles: metric.processedFiles,
      failedFiles: metric.failedFiles,
      unsupportedFiles: metric.unsupportedFiles,
      incremental: metric.incremental,
      status: metric.status,
      partialFailure: metric.partialFailure,
      parserDurationsMs: metric.parserDurationsMs,
    }),
  })
  const disposeProjectIndex = registerProjectIndexIpc(
    win,
    projectIndex,
    { assertAuthorized: (value) => getAuthorizedWorkspace(database, value) },
    ipcMain,
  )
  const validation = new ValidationPipeline(
    database.validation,
    (workspace) => projectIndex.listStackEvidence(workspace),
    {
      onStatus: (run) => win.webContents.send(IPC_CHANNELS.validation.changed, run),
      onMetric: (metric) => logger.info('validation', 'Métrica de validação concluída.', {
        validationKind: metric.validationKind,
        durationMs: metric.durationMs,
        status: metric.status,
      }),
    },
  )
  const disposeValidation = registerValidationIpc(
    win,
    validation,
    { assertAuthorized: (value) => getAuthorizedWorkspace(database, value) },
    ipcMain,
  )
  const disposeData = registerDataIpc(win, database, logger, ipcMain)
  const disposeGit = registerGitIpc(win, database, ipcMain)
  const disposeWorkspace = registerWorkspaceIpc(
    win,
    database,
    {
      ensureWorkspace: ensureNocturneWorkspace,
      assertKnownWorkspace: (value) => getAuthorizedWorkspace(database, value),
      run: runWorkspaceCommand,
      onWorkspaceChanged: (event) => projectIndex.enqueueChange(event),
      onWorkspaceWatch: (workspace) => {
        void projectIndex.ensureIndexed(workspace).catch((error) => logger.warn('index', 'A indexação não pôde ser iniciada.', { reason: error instanceof Error ? error.message : String(error) }))
      },
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
    undefined,
    undefined,
    (executionId, lifecycle) => persistExecutionLifecycle(database, executionId, lifecycle),
  )

  const disposeCodex = registerCodexIpc(win, codexAccount, aiExecutions, ipcMain)
  const disposeFiles = registerFilesIpc(win, database, ipcMain)
  const disposeDiagnostics = registerDiagnosticsIpc(win, logger, providerConfigurations, modelRegistry, ipcMain, () => ({ index: projectIndex.getMetrics(), validation: validation.getMetrics() }))
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
      projectIndex,
    },
    ipcMain,
  )
  const disposeSettings = registerSettingsIpc(win, database, logger, ipcMain)
  const disposeDocuments = registerDocumentsIpc(win, database, documentUpdates, ipcMain)

  return () => {
    aiExecutions.dispose()
    ipcMain.dispose()
    return Promise.all([
      validation.dispose(),
      projectIndex.dispose(),
      disposeProjectIndex(),
      disposeValidation(),
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

function persistExecutionLifecycle(database: LocalDatabase, executionId: string, lifecycle: AgentRunState) {
  const current = database.getExecution(executionId)
  if (!current) return
  const status = lifecycle.state === 'waiting-approval' || lifecycle.state === 'cancelling' ? 'running' : lifecycle.state
  database.saveExecution({
    ...current,
    status,
    finishedAt: isTerminalAgentState(lifecycle.state) ? lifecycle.updatedAt : current.finishedAt,
    error: lifecycle.error ?? current.error,
  })
}
