import { dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AwarenessSnapshot } from '../../shared/awareness'
import { AI_TASK_LIMITS, type NormalizedTaskInput } from '../../shared/ai/task'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { aiCancelSchema, aiSendSchema, approvalSchema, idSchema, saveAssistantSchema } from '../../shared/ipc/schemas'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import { buildBrainMemoryContext } from '../memory/BrainMemoryContext'
import { isWorkspaceFileTooLarge, readWorkspaceFile } from '../security/ExecutionPolicy'
import type { LocalDatabase } from '../database/Database'
import type { Logger } from '../logging/Logger'
import { BuildRollbackService } from '../ai/BuildRollbackService'
import { AiExecutionCoordinator } from '../ai/AiExecutionCoordinator'
import { buildAttachmentMessages, buildHistoryMessages } from '../ai/conversationContext'
import { getAuthorizedConversation } from './conversationAccess'
import { artifactType, assertInsideWorkspace } from './fileAccess'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import type { ProviderConfigurationOperations } from './registerProviderIpc'
import type { ProjectIndexService } from '../project-index/ProjectIndexService'
import type { ExecutionRecord } from '../../shared/changeControl'

interface WorkspaceContext {
  content: string
  rules: string
  updatedAt: string
}

interface AiIpcDependencies {
  database: LocalDatabase
  logger: Logger
  providerConfigurations: ProviderConfigurationOperations
  aiExecutions: AiExecutionCoordinator
  buildRollback: BuildRollbackService
  approvalDetails: Map<string, { command?: string; risk?: string }>
  readWorkspaceContext(workspace: string): Promise<WorkspaceContext>
  projectIndex: ProjectIndexService
}

export function registerAiIpc(win: BrowserWindow, dependencies: AiIpcDependencies, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const { database, logger, providerConfigurations, aiExecutions, buildRollback, approvalDetails, readWorkspaceContext, projectIndex } = dependencies

  ipcMain.handle(IPC_CHANNELS.ai.send, async (_event, value: unknown) => {
    const { conversationId, prompt, attachments, mode } = aiSendSchema.parse(value)
    const conversation = getAuthorizedConversation(database, conversationId)
    attachments.forEach((filePath) => assertInsideWorkspace(filePath, conversation.workspace))

    const bindings = database.workspaceModelBindings.get(conversation.workspace)
    const enabledProviders = providerConfigurations.list().filter((provider) => provider.enabled)
    const hasActiveModel = Boolean(enabledProviders.length > 0 && bindings?.defaultBinding)
    const useCodex = mode !== 'review' || !hasActiveModel

    if (!useCodex && (!bindings || !hasActiveModel)) throw new Error('Nenhuma IA configurada. Abra Configurações > IA para conectar um provedor.')

    const history = database.listRecentMessages(conversationId, AI_TASK_LIMITS.messages)
    const workspaceMemory = await loadWorkspaceMemoryForAi(database, conversation.workspace, readWorkspaceContext)
    const brainMemory = buildBrainMemoryContext(database, conversation.workspace, conversationId, prompt)
    const projectContext = projectIndex.buildAiContext(conversation.workspace, prompt)
    const projectPath = path.join(conversation.workspace, '.nocturne', 'project.json')
    let projectName = path.basename(conversation.workspace)
    try {
      const projectData = JSON.parse((await readWorkspaceFile(projectPath, conversation.workspace, WORKSPACE_READ_LIMITS.projectMetadataBytes)).content.toString('utf8')) as { name?: string }
      if (projectData.name) projectName = projectData.name
    } catch (error) {
      if (isWorkspaceFileTooLarge(error)) throw new Error('O metadata do projeto excede o limite permitido.')
      if (!((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)) throw new Error('Não foi possível ler o metadata do projeto com segurança.')
    }

    const contextSources: NormalizedTaskInput['context'] = []
    if (workspaceMemory.content) {
      contextSources.push({ id: 'workspace-memory', type: 'memory', title: 'Memória do workspace', content: workspaceMemory.content, scope: 'workspace', updatedAt: workspaceMemory.updatedAt || undefined, potentiallyOutdated: true })
    }
    if (brainMemory.text) {
      contextSources.push({ id: 'brain-memory', type: 'memory', title: 'Segundo Cérebro', content: brainMemory.text, scope: 'workspace-and-conversation', potentiallyOutdated: true })
    }
    if (projectContext?.text) {
      contextSources.push({ id: `project-index:${projectContext.runId}`, type: 'project-index', title: 'Índice estrutural do projeto', content: projectContext.text, scope: 'workspace', updatedAt: projectContext.updatedAt, potentiallyOutdated: projectContext.potentiallyOutdated })
    }
    const awareness: AwarenessSnapshot = {
      mode,
      createdAt: new Date().toISOString(),
      selections: [
        ...(workspaceMemory.content ? [{
          id: 'workspace-memory',
          title: 'Memória do workspace',
          source: 'workspace-memory' as const,
          sourceType: 'workspace' as const,
          sourceId: null,
          kind: 'workspace-context' as const,
          scope: 'workspace' as const,
          relevance: 100,
          reason: 'Contexto explícito mantido pelo usuário para todas as execuções deste workspace.',
          updatedAt: workspaceMemory.updatedAt || null,
          contentPreview: workspaceMemory.content.slice(0, 500),
        }] : []),
        ...brainMemory.selections,
        ...(projectContext?.selections ?? []),
      ],
    }
    const executionId = randomUUID()
    const execution: ExecutionRecord = {
      id: executionId,
      workspace: conversation.workspace,
      conversationId,
      prompt,
      mode,
      status: 'created',
      decision: 'pending',
      retryOf: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    }
    database.createExecution(execution)
    database.addMessage(conversationId, 'user', prompt, { executionId, attachments, awareness })
    if (conversation.title === 'Nova conversa') database.renameFromPrompt(conversationId, prompt)

    const attachmentMessages = await buildAttachmentMessages(attachments, conversation.workspace)
    const messages = [...buildHistoryMessages(history, AI_TASK_LIMITS.messages - attachmentMessages.length), ...attachmentMessages]
    const taskInput: NormalizedTaskInput = {
      workspace: { id: conversation.workspace, name: projectName },
      intent: prompt,
      mode: mode === 'review' ? 'review' : 'build',
      messages,
      context: contextSources,
      constraints: [],
      requirements: ['chat', 'streaming'],
      selection: { type: 'workspace-default' },
      output: { format: 'markdown' },
      permissions: { workspaceAccess: mode === 'review' ? 'read-only' : 'workspace-write' },
      tools: [],
    }

    if (useCodex) {
      const settings = database.getSettings()
      if (mode === 'build') await buildRollback.begin(conversationId, conversation.workspace)
      try {
        await aiExecutions.startCodex({
          conversationId,
          executionId,
          workspace: conversation.workspace,
          prompt,
          initialPrompt: buildCodexPrompt(history, prompt),
          attachments,
          memory: joinMemoryContext(workspaceMemory.content, brainMemory.text),
          mode,
          threadId: conversation.codexThreadId,
          settings: {
            model: settings.model || '',
            sandbox: mode === 'review' ? 'read-only' : 'workspace-write',
            approvalPolicy: settings.approvalPolicy === 'untrusted' ? 'untrusted' : 'on-request',
            diagnosticMode: settings.diagnosticMode === 'true',
            theme: settings.theme === 'light' ? 'light' : 'dark',
          },
        })
      } catch (error) {
        if (mode === 'build') buildRollback.abort(conversationId)
        throw error
      }
      database.markBrainMemoriesUsed(brainMemory.memoryIds)
      return
    }

    await aiExecutions.startProvider(conversationId, taskInput, bindings!, executionId)
    database.markBrainMemoriesUsed(brainMemory.memoryIds)
  })

  ipcMain.handle(IPC_CHANNELS.ai.cancel, async (_event, value: unknown) => {
    const { conversationId } = aiCancelSchema.parse(value)
    getAuthorizedConversation(database, conversationId)
    await aiExecutions.cancel(conversationId)
  })

  ipcMain.handle(IPC_CHANNELS.ai.rollbackStatus, (_event, value: unknown) => {
    const conversation = getAuthorizedConversation(database, idSchema.parse(value))
    return buildRollback.status(conversation.id)
  })
  ipcMain.handle(IPC_CHANNELS.ai.rollback, async (_event, value: unknown) => {
    const conversation = getAuthorizedConversation(database, idSchema.parse(value))
    const status = buildRollback.status(conversation.id)
    if (!status.available) throw new Error(status.reason ?? 'Este Build não pode ser revertido.')
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Reverter Build'],
      defaultId: 0,
      cancelId: 0,
      title: 'Reverter alterações do Build',
      message: `Restaurar ${status.files.length} arquivo(s) para o estado anterior ao Build?`,
      detail: 'A reversão é limitada aos caminhos reportados pelo agente e exige que o workspace estivesse limpo antes da execução. Revise o diff atual antes de continuar.',
    })
    if (confirmation.response !== 1) return null
    const result = await buildRollback.rollback(conversation.id, conversation.workspace)
    logger.info('ai', 'Rollback de Build concluído', { conversationId: conversation.id, files: result.restored })
    return result
  })

  ipcMain.handle(IPC_CHANNELS.ai.saveAssistant, (_event, value: unknown) => {
    const data = saveAssistantSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : undefined
    const artifacts: Array<{ type: string; title: string; filePath?: string | null; content?: string | null }> = []
    for (const file of Array.isArray(metadata?.files) ? metadata.files : []) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) continue
      const filePath = typeof (file as { path?: unknown }).path === 'string' ? (file as { path: string }).path : ''
      if (!filePath) continue
      artifacts.push({ type: artifactType(filePath), title: path.basename(filePath), filePath })
    }
    if (typeof metadata?.diff === 'string' && metadata.diff) artifacts.push({ type: 'report', title: 'Alterações do turno', content: metadata.diff })
    return database.saveAssistantTurn(data.conversationId, conversation.workspace, data.content, data.metadata, artifacts)
  })

  ipcMain.handle(IPC_CHANNELS.ai.approve, async (_event, value: unknown) => {
    const data = approvalSchema.parse(value)
    await aiExecutions.resolveApproval(data.key, data.accepted, data.forSession)
    const detail = approvalDetails.get(data.key)
    database.recordApproval(data.key, data.accepted, detail?.command, detail?.risk)
    approvalDetails.delete(data.key)
    logger.info('ai', data.accepted ? 'Aprovação concedida' : 'Aprovação recusada', { approvalKey: data.key, risk: detail?.risk })
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

async function loadWorkspaceMemoryForAi(database: LocalDatabase, workspace: string, readWorkspaceContext: (workspace: string) => Promise<WorkspaceContext>) {
  const [files, persisted] = await Promise.all([readWorkspaceContext(workspace), Promise.resolve(database.getWorkspaceMemory(workspace))])
  if (persisted.content && Date.parse(persisted.updatedAt) > Date.parse(files.updatedAt)) return persisted
  return { content: `${files.content}\n\n# Regras do projeto\n${files.rules}`.trim(), updatedAt: files.updatedAt }
}

function joinMemoryContext(workspaceMemory: string, brainMemory: string) {
  return [workspaceMemory, brainMemory].filter(Boolean).join('\n\n')
}

function buildCodexPrompt(history: ReturnType<LocalDatabase['listMessages']>, prompt: string) {
  const recent = history.slice(-40)
  if (!recent.length) return prompt
  const transcript = recent.map((message) => `${message.role === 'assistant' ? 'Assistente' : 'Usuário'}: ${message.content}`).join('\n\n')
  return `Histórico recente desta conversa:\n\n${transcript}\n\nSolicitação atual do usuário:\n\n${prompt}`
}
