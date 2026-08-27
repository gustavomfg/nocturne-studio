import { BrowserWindow, clipboard, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { diagnosticFingerprint, redactLogText } from '../logging/Logger'
import { LocalDatabase } from '../database/Database'
import { Logger } from '../logging/Logger'
import { isExternalOpenBlocked, isWorkspaceFileTooLarge, readWorkspaceFile, resolveExistingWorkspacePath, resolveInsideWorkspace, sanitizeWorkspaceReadError, statWorkspaceFile } from '../security/ExecutionPolicy'
import { sanitizeSuggestionTitle } from '../../shared/suggestions'
import { appendSuggestionDecision } from '../persistence/SuggestionDecisionLog'
import { writeAtomicFile } from '../persistence/AtomicFile'
import { approvalSchema, aiCancelSchema, aiSendSchema, applyMarkdownSchema, exportDocumentSchema, fileActionSchema, filePreviewSchema, idSchema, prepareMarkdownSchema, rendererStatsSchema, saveAssistantSchema } from '../../shared/ipc/schemas'
import { registerDataIpc } from './registerDataIpc'
import { registerGitIpc } from './registerGitIpc'
import { registerWorkspaceIpc } from './registerWorkspaceIpc'
import { registerKnowledgeIpc } from './registerKnowledgeIpc'
import { safeIpcMain } from './safeIpc'
import { getAuthorizedConversation, getAuthorizedWorkspace } from './conversationAccess'
import {
  registerProviderIpc,
  type ProviderConfigurationOperations,
} from './registerProviderIpc'
import {
  registerModelIpc,
  type ModelCatalogOperations,
} from './registerModelIpc'
import { ModelRegistry } from '../ai/ModelRegistry'
import { ProviderRegistry } from '../ai/ProviderRegistry'
import { AiExecutionCoordinator } from '../ai/AiExecutionCoordinator'
import { persistCompletedTurn } from '../ai/TurnPersistence'
import { buildAttachmentMessages, buildHistoryMessages } from '../ai/conversationContext'
import type { NormalizedTaskInput } from '../../shared/ai/task'
import { AI_TASK_LIMITS } from '../../shared/ai/task'
import { buildBrainMemoryContext } from '../memory/BrainMemoryContext'
import { CodexAccountService } from '../codex/CodexAccountService'
import { BuildRollbackService } from '../ai/BuildRollbackService'
import { DocumentUpdateService } from '../documents/DocumentUpdateService'
import { resolveExecutable } from '../runtime/resolveExecutable'
import type { AwarenessSnapshot } from '../../shared/awareness'
import packageMetadata from '../../package.json'
import { RENDERER_PERFORMANCE_BUDGETS, WORKSPACE_READ_LIMITS } from '../../shared/constants'

const execFileAsync = promisify(execFile)

export function registerIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  logger: Logger,
  providerConfigurations: ProviderConfigurationOperations,
  modelCatalog: ModelCatalogOperations,
  modelRegistry: ModelRegistry,
  providerRegistry: ProviderRegistry,
) {
  const ipcMain = safeIpcMain(win)
  const disposeData = registerDataIpc(win, database, logger)
  const disposeGit = registerGitIpc(win, database)
  const disposeWorkspace = registerWorkspaceIpc(win, database, { ensureWorkspace: ensureNocturneWorkspace, assertKnownWorkspace: (value) => getAuthorizedWorkspace(database, value), run })
  const disposeKnowledge = registerKnowledgeIpc(win, database, logger, { authorizedWorkspace: (id) => getAuthorizedConversation(database, id).workspace, read: readWorkspaceContext, write: writeWorkspaceContext, recordDecision: recordSuggestionDecision })
  const disposeProviders = registerProviderIpc(win, providerConfigurations)
  const disposeModels = registerModelIpc(win, database, modelCatalog)
  ipcMain.handle('clipboard:readText', () => clipboard.readText().slice(0, 10_000))
  ipcMain.handle('clipboard:writeText', (_event, value: unknown) => { clipboard.writeText(z.string().max(100_000).parse(value)) })

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
  const codexStatus = async () => {
    const account = await codexAccount.status()
    if (!account.installed || !account.compatible) return account
    try {
      const protocol = await aiExecutions.checkCodexProtocol()
      return { ...account, protocolCompatible: true, serverVersion: protocol.serverVersion }
    } catch (error) {
      return {
        ...account,
        state: 'internal-error' as const,
        protocolCompatible: false,
        error: `O Codex CLI foi encontrado, mas o App Server não respondeu com um protocolo compatível: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  ipcMain.handle('codex:accountStatus', () => codexStatus())
  ipcMain.handle('codex:login', async () => {
    await codexAccount.login()
    return codexStatus()
  })
  ipcMain.handle('codex:logout', () => codexAccount.logout())
  ipcMain.handle('codex:models', async () => {
    const account = await codexAccount.status()
    if (!account.authenticated || account.authenticationMethod !== 'chatgpt') {
      throw new Error('Conecte uma conta ChatGPT antes de listar os modelos do Codex.')
    }
    return aiExecutions.listCodexModels()
  })

  ipcMain.handle('files:attach', async (_event, value: unknown) => {
    const conversation = getAuthorizedConversation(database, idSchema.parse(value))
    const result = await dialog.showOpenDialog(win, {
      title: 'Anexar arquivos de texto', defaultPath: conversation.workspace, properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Arquivos do projeto', extensions: ['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'sql', 'env', 'ini'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
    })
    if (result.canceled) return []
    return (await Promise.all(result.filePaths.map(async (filePath) => {
      const inspected = await statWorkspaceFile(filePath, conversation.workspace)
      const stat = inspected.stat
      if (!stat.isFile()) throw new Error(`${path.basename(filePath)} não é um arquivo válido.`)
      if (stat.size > WORKSPACE_READ_LIMITS.attachmentBytes) throw new Error(`${path.basename(filePath)} excede o limite de 1 MB.`)
      return { path: path.relative(conversation.workspace, inspected.path), name: path.basename(inspected.path), size: stat.size }
    })))
  })

  ipcMain.handle('files:open', async (_event, value: unknown) => {
    const data = fileActionSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const filePath = resolveExistingWorkspacePath(data.filePath, conversation.workspace)
    if (data.action === 'folder') {
      const revalidatedPath = resolveExistingWorkspacePath(data.filePath, conversation.workspace)
      shell.showItemInFolder(revalidatedPath)
      return
    }
    if (isExternalOpenBlocked(filePath)) {
      throw new Error('Abrir executáveis, atalhos, URLs e scripts diretamente não é permitido por segurança.')
    }
    const revalidatedPath = resolveExistingWorkspacePath(data.filePath, conversation.workspace)
    const error = await shell.openPath(revalidatedPath)
    if (error) throw new Error(error)
  })

  ipcMain.handle('files:preview', async (_event, value: unknown) => {
    const data = filePreviewSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    let file
    try {
      file = await readWorkspaceFile(data.filePath, conversation.workspace, WORKSPACE_READ_LIMITS.documentBytes)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new Error('Arquivo não encontrado.')
      if (code === 'EFBIG') throw new Error('Preview limitado a arquivos de até 2 MB.')
      throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o arquivo com segurança.')
    }
    const filePath = file.path
    const stat = file.stat
    const extension = path.extname(filePath).toLowerCase()
    const imageMime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string, string>)[extension]
    if (imageMime) return { kind: 'image', name: path.basename(filePath), filePath, mime: imageMime, content: `data:${imageMime};base64,${file.content.toString('base64')}`, size: stat.size }
    if (!isTextFile(extension)) throw new Error('Este formato não possui preview interno.')
    return { kind: extension === '.md' ? 'markdown' : 'text', name: path.basename(filePath), filePath, mime: 'text/plain', content: file.content.toString('utf8'), size: stat.size }
  })

  const diagnosticReport = () => ({
    app: 'Nocturne Studio',
    version: packageMetadata.version,
    platform: process.platform,
    arch: process.arch,
    runtime: { node: process.versions.node, electron: process.versions.electron ?? 'indisponível' },
    session: logger.snapshot(),
    providers: {
      configured: providerConfigurations.list().length,
      enabled: providerConfigurations.list().filter((provider) => provider.enabled).length,
    },
    models: modelRegistry.list().length,
  })
  ipcMain.handle('diagnostics:openLogs', () => shell.openPath(logger.path))
  ipcMain.handle('diagnostics:copy', async () => JSON.stringify(diagnosticReport(), null, 2))
  ipcMain.handle('diagnostics:export', async () => {
    const result = await dialog.showSaveDialog(win, { title: 'Exportar diagnóstico sanitizado', defaultPath: `nocturne-diagnostic-${logger.snapshot().sessionId.slice(0, 8)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    await atomicWrite(result.filePath, `${JSON.stringify(diagnosticReport(), null, 2)}\n`)
    return result.filePath
  })
  ipcMain.handle('diagnostics:rendererError', (_event, value: unknown) => {
    const data = z.object({ type: z.enum(['error', 'unhandledRejection']), message: z.string().max(8_000), stack: z.string().max(20_000).optional() }).parse(value)
    const fingerprint = diagnosticFingerprint(`${data.message}\n${data.stack ?? ''}`)
    logger.error('app', `Renderer ${data.type}`, { fingerprint })
  })
  ipcMain.handle('diagnostics:rendererStats', (_event, value: unknown) => {
    const data = rendererStatsSchema.parse(value)
    logger.info('app', 'Métricas internas do renderer', {
      ...data,
      budgetExceeded: {
        startup: data.startupMs > RENDERER_PERFORMANCE_BUDGETS.startupMs,
        conversationLoad: data.conversationLoadMs > RENDERER_PERFORMANCE_BUDGETS.conversationLoadMs,
        longTask: data.longestLongTaskMs > RENDERER_PERFORMANCE_BUDGETS.longTaskMs,
      },
    })
  })

  ipcMain.handle('ai:send', async (_event, value: unknown) => {
    const { conversationId, prompt, attachments, mode } = aiSendSchema.parse(value)
    const conversation = getAuthorizedConversation(database, conversationId)
    attachments.forEach((filePath) => assertInsideWorkspace(filePath, conversation.workspace))

    const bindings = database.workspaceModelBindings.get(conversation.workspace)
    const enabledProviders = providerConfigurations.list().filter((p) => p.enabled)
    const hasActiveModel = Boolean(enabledProviders.length > 0 && bindings?.defaultBinding)
    const useCodex = mode !== 'review' || !hasActiveModel

    if (!useCodex && (!bindings || !hasActiveModel)) {
      throw new Error('Nenhuma IA configurada. Abra Configurações > IA para conectar um provedor.')
    }

    const history = database.listRecentMessages(conversationId, AI_TASK_LIMITS.messages)
    const workspaceMemory = await loadWorkspaceMemoryForAi(database, conversation.workspace)
    const brainMemory = buildBrainMemoryContext(
      database,
      conversation.workspace,
      conversationId,
      prompt,
    )
    const projectPath = path.join(conversation.workspace, '.nocturne', 'project.json')
    let projectName = path.basename(conversation.workspace)
    try {
      const projectData = JSON.parse((await readWorkspaceFile(projectPath, conversation.workspace, WORKSPACE_READ_LIMITS.projectMetadataBytes)).content.toString('utf8')) as { name?: string }
      if (projectData.name) projectName = projectData.name
    } catch (error) {
      if (isWorkspaceFileTooLarge(error)) throw new Error('O metadata do projeto excede o limite permitido.')
      if (!((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)) throw new Error('Não foi possível ler o metadata do projeto com segurança.')
      /* use directory name for missing or malformed metadata */
    }

    const contextSources: NormalizedTaskInput['context'] = []
    if (workspaceMemory.content) {
      contextSources.push({
        id: 'workspace-memory',
        type: 'memory',
        title: 'Memória do workspace',
        content: workspaceMemory.content,
        scope: 'workspace',
        updatedAt: workspaceMemory.updatedAt || undefined,
        potentiallyOutdated: true,
      })
    }
    if (brainMemory.text) {
      contextSources.push({
        id: 'brain-memory',
        type: 'memory',
        title: 'Segundo Cérebro',
        content: brainMemory.text,
        scope: 'workspace-and-conversation',
        potentiallyOutdated: true,
      })
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
      ],
    }
    database.addMessage(conversationId, 'user', prompt, { attachments, awareness })
    if (conversation.title === 'Nova conversa') database.renameFromPrompt(conversationId, prompt)

    const attachmentMessages = await buildAttachmentMessages(attachments, conversation.workspace)
    const messages = [
      ...buildHistoryMessages(history, AI_TASK_LIMITS.messages - attachmentMessages.length),
      ...attachmentMessages,
    ]

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
          theme: 'dark',
        },
        })
      } catch (error) {
        if (mode === 'build') buildRollback.abort(conversationId)
        throw error
      }
      database.markBrainMemoriesUsed(brainMemory.memoryIds)
      return
    }

    await aiExecutions.startProvider(conversationId, taskInput, bindings!)
    database.markBrainMemoriesUsed(brainMemory.memoryIds)
  })

  ipcMain.handle('ai:cancel', async (_event, value: unknown) => {
    const { conversationId } = aiCancelSchema.parse(value)
    getAuthorizedConversation(database, conversationId)
    await aiExecutions.cancel(conversationId)
  })

  ipcMain.handle('ai:rollbackStatus', (_event, value: unknown) => {
    const conversation = getAuthorizedConversation(database, idSchema.parse(value))
    return buildRollback.status(conversation.id)
  })
  ipcMain.handle('ai:rollback', async (_event, value: unknown) => {
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

  ipcMain.handle('ai:save-assistant', (_event, value: unknown) => {
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

  ipcMain.handle('ai:approve', async (_event, value: unknown) => {
    const data = approvalSchema.parse(value)
    await aiExecutions.resolveApproval(data.key, data.accepted, data.forSession)
    const detail = approvalDetails.get(data.key)
    database.recordApproval(data.key, data.accepted, detail?.command, detail?.risk)
    approvalDetails.delete(data.key)
    logger.info('ai', data.accepted ? 'Aprovação concedida' : 'Aprovação recusada', { approvalKey: data.key, risk: detail?.risk })
  })

  const readSettings = () => {
    const saved = database.getSettings()
    return { ...saved, diagnosticMode: saved.diagnosticMode === 'true' }
  }
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_event, value: unknown) => {
    const data = z.object({ model: z.string().max(100).optional(), sandbox: z.enum(['read-only', 'workspace-write']).optional(), approvalPolicy: z.enum(['untrusted', 'on-request']).optional(), diagnosticMode: z.boolean().optional(), theme: z.literal('dark').default('dark') }).parse(value)
    if (data.diagnosticMode !== undefined) logger.setDiagnostic(data.diagnosticMode)
    const { diagnosticMode, ...rest } = data
    const updates: Record<string, string> = { ...rest }
    if (diagnosticMode !== undefined) updates.diagnosticMode = String(diagnosticMode)
    database.setSettings(updates)
    return readSettings()
  })

  ipcMain.handle('documents:prepareMarkdown', async (_event, value: unknown) => {
    const data = prepareMarkdownSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const result = await dialog.showSaveDialog(win, { title: 'Salvar documento Markdown', defaultPath: path.join(conversation.workspace, safeName(data.name, '.md')), filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (result.canceled || !result.filePath) return null
    assertInsideWorkspace(result.filePath, conversation.workspace)
    return documentUpdates.preview(conversation.workspace, result.filePath, data.content)
  })
  ipcMain.handle('documents:applyMarkdown', async (_event, value: unknown) => {
    const data = applyMarkdownSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const action = data.strategy === 'append' ? 'Anexar conteúdo' : 'Substituir documento'
    const confirmation = await dialog.showMessageBox(win, {
      type: data.strategy === 'replace' ? 'warning' : 'info',
      buttons: ['Cancelar', action],
      defaultId: 0,
      cancelId: 0,
      title: 'Aplicar atualização de documentação',
      message: `${action} em ${path.basename(data.target)}?`,
      detail: 'O arquivo só será gravado se permanecer igual ao conteúdo exibido no preview.',
    })
    if (confirmation.response !== 1) return null
    const applied = await documentUpdates.apply(conversation.workspace, data.target, data.generated, data.strategy, data.expectedHash)
    database.addArtifact(data.conversationId, conversation.workspace, 'document', path.basename(applied.target), applied.target, applied.content, { format: 'md', strategy: data.strategy })
    return { target: applied.target, strategy: applied.strategy }
  })

  ipcMain.handle('documents:export', async (_event, value: unknown) => {
    const data = exportDocumentSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const pandocPath = await resolveExecutable('pandoc')
    if (!pandocPath) throw new Error('Pandoc não foi encontrado no PATH.')
    const result = await dialog.showSaveDialog(win, { title: `Exportar ${data.format.toUpperCase()}`, defaultPath: path.join(conversation.workspace, `documento.${data.format}`), filters: [{ name: data.format.toUpperCase(), extensions: [data.format] }] })
    if (result.canceled || !result.filePath) return null
    const target = resolveWorkspaceFile(result.filePath, conversation.workspace)
    const temporary = resolveWorkspaceFile(`${target}.tmp-${process.pid}-${randomUUID()}`, conversation.workspace)
    try {
      await pipeCommand(pandocPath, ['-f', 'markdown', '-t', data.format, '-o', temporary], data.content, conversation.workspace)
      const revalidatedTarget = resolveWorkspaceFile(result.filePath, conversation.workspace)
      if (revalidatedTarget !== target) throw new Error('O destino da exportação mudou depois da seleção.')
      await fs.promises.rename(temporary, target)
      await fs.promises.chmod(target, 0o600)
      const artifactContent = data.format === 'html'
        ? (await readWorkspaceFile(target, conversation.workspace, WORKSPACE_READ_LIMITS.documentBytes)).content.toString('utf8')
        : null
      database.addArtifact(data.conversationId, conversation.workspace, 'document', path.basename(target), target, artifactContent, { format: data.format })
      return target
    } finally {
      await fs.promises.unlink(temporary).catch(() => undefined)
    }
  })
  return () => {
    aiExecutions.dispose()
    ipcMain.dispose()
    disposeKnowledge()
    disposeWorkspace()
    disposeGit()
    disposeData()
    disposeProviders()
    disposeModels()
  }
}

async function loadWorkspaceMemoryForAi(database: LocalDatabase, workspace: string) {
  const [files, persisted] = await Promise.all([
    readWorkspaceContext(workspace),
    Promise.resolve(database.getWorkspaceMemory(workspace)),
  ])
  if (persisted.content && Date.parse(persisted.updatedAt) > Date.parse(files.updatedAt)) {
    return persisted
  }
  return {
    content: `${files.content}\n\n# Regras do projeto\n${files.rules}`.trim(),
    updatedAt: files.updatedAt,
  }
}

function joinMemoryContext(workspaceMemory: string, brainMemory: string) {
  return [workspaceMemory, brainMemory].filter(Boolean).join('\n\n')
}

function buildCodexPrompt(
  history: ReturnType<LocalDatabase['listMessages']>,
  prompt: string,
) {
  const recent = history.slice(-40)
  if (!recent.length) return prompt
  const transcript = recent.map((message) => {
    const role = message.role === 'assistant' ? 'Assistente' : 'Usuário'
    return `${role}: ${message.content}`
  }).join('\n\n')
  return `Histórico recente desta conversa:\n\n${transcript}\n\nSolicitação atual do usuário:\n\n${prompt}`
}

function assertInsideWorkspace(filePath: string, workspace: string) {
  try { resolveInsideWorkspace(filePath, workspace) }
  catch { throw new Error('O arquivo precisa estar dentro do workspace selecionado.') }
}

function resolveWorkspaceFile(filePath: string, workspace: string) {
  return resolveInsideWorkspace(filePath, workspace)
}

function isTextFile(extension: string) {
  return new Set(['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.toml', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.sh', '.sql', '.env', '.gitignore']).has(extension)
}

function artifactType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) return 'image'
  if (extension === '.md') return 'markdown'
  if (['.json', '.yaml', '.yml', '.toml', '.env', '.ini'].includes(extension)) return 'configuration'
  if (['.docx', '.pdf', '.html'].includes(extension)) return 'document'
  return 'code'
}

async function run(command: string, args: string[], cwd: string) {
  try { return await execFileAsync(command, args, { cwd, timeout: 20_000, maxBuffer: 5_000_000 }) }
  catch (error) { throw new Error(error instanceof Error ? redactLogText(error.message.slice(0, 2_000)) : String(error)) }
}

function safeName(name: string, extension: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '-')
  return base.endsWith(extension) ? base : `${base}${extension}`
}

function pipeCommand(command: string, args: string[], input: string, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'ignore', 'pipe'] })
    let error = ''
    let settled = false
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (failure?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (failure) reject(failure)
      else resolve()
    }
    const timeoutError = new Error('A exportação excedeu o limite de 60 segundos.')
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      killTimer = setTimeout(() => finish(timeoutError), 5_000)
    }, 60_000)
    child.stderr.on('data', (chunk) => { error = `${error}${chunk.toString()}`.slice(-64_000) })
    child.stdin.on('error', (failure) => finish(timedOut ? timeoutError : failure))
    child.on('error', (failure) => finish(timedOut ? timeoutError : failure))
    child.on('close', (code) => {
      if (timedOut) finish(timeoutError)
      else if (code === 0) finish()
      else finish(new Error(error || `Pandoc encerrou com código ${code}.`))
    })
    child.stdin.end(input)
  })
}

interface ProjectContext { name: string; stack: string[]; primaryLanguage: string; commands: Record<string, string> }

async function ensureNocturneWorkspace(workspace: string) {
  const directory = path.join(workspace, '.nocturne')
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  resolveInsideWorkspace(directory, workspace)
  const projectPath = path.join(directory, 'project.json')
  const memoryPath = path.join(directory, 'memory.md')
  const rulesPath = path.join(directory, 'rules.md')
  const project = await detectProject(workspace)
  await Promise.all([
    ensureProjectMetadata(projectPath, workspace, project),
    writeIfMissing(memoryPath, '# Memória do projeto\n\nDecisões, arquitetura e informações aprendidas pelo agente.\n'),
    writeIfMissing(rulesPath, '# Regras do projeto\n\nPreferências e padrões de código que o agente deve seguir.\n'),
  ])
}

async function readWorkspaceContext(workspace: string) {
  await ensureNocturneWorkspace(workspace)
  const directory = path.join(workspace, '.nocturne')
  let project = await detectProject(workspace)
  try {
    project = JSON.parse((await readWorkspaceFile(path.join(directory, 'project.json'), workspace, WORKSPACE_READ_LIMITS.projectMetadataBytes)).content.toString('utf8')) as ProjectContext
  } catch (error) {
    if (isWorkspaceFileTooLarge(error)) throw new Error('O metadata do projeto excede o limite permitido.')
    if (!((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)) throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o metadata do projeto com segurança.')
    // Regenerate invalid metadata on save, preserving the existing contract.
  }
  const memoryPath = path.join(directory, 'memory.md')
  const rulesPath = path.join(directory, 'rules.md')
  const [memory, rules] = await Promise.all([
    readWorkspaceContextFile(memoryPath, workspace),
    readWorkspaceContextFile(rulesPath, workspace),
  ])
  return {
    content: memory.content.toString('utf8'),
    rules: rules.content.toString('utf8'),
    project,
    updatedAt: new Date(Math.max(memory.stat.mtimeMs, rules.stat.mtimeMs)).toISOString(),
  }
}

async function writeWorkspaceContext(workspace: string, content: string, rules: string) {
  await ensureNocturneWorkspace(workspace)
  const directory = path.join(workspace, '.nocturne')
  const project = await detectProject(workspace)
  await Promise.all([
    atomicWrite(path.join(directory, 'memory.md'), content),
    atomicWrite(path.join(directory, 'rules.md'), rules),
    atomicWrite(path.join(directory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`),
  ])
  return { content, rules, project, updatedAt: new Date().toISOString() }
}

async function readWorkspaceContextFile(filePath: string, workspace: string) {
  try {
    return await readWorkspaceFile(filePath, workspace, WORKSPACE_READ_LIMITS.workspaceContextBytes)
  } catch (error) {
    if (isWorkspaceFileTooLarge(error)) throw new Error('O contexto do workspace excede o limite permitido.')
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Arquivo de contexto do workspace não encontrado.')
    throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o contexto do workspace com segurança.')
  }
}

async function detectProject(workspace: string): Promise<ProjectContext> {
  const files = new Set(await fs.promises.readdir(workspace))
  const stack: string[] = []
  const commands: Record<string, string> = {}
  let primaryLanguage = 'Desconhecida'
  if (files.has('package.json')) {
    stack.push('Node.js'); primaryLanguage = files.has('tsconfig.json') ? 'TypeScript' : 'JavaScript'
    try {
      const pkg = JSON.parse((await readWorkspaceFile(path.join(workspace, 'package.json'), workspace, WORKSPACE_READ_LIMITS.packageMetadataBytes)).content.toString('utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      Object.assign(commands, pkg.scripts ?? {})
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      for (const [dependency, label] of Object.entries({ react: 'React', vue: 'Vue', electron: 'Electron', next: 'Next.js', vite: 'Vite' })) if (deps[dependency]) stack.push(label)
    } catch (error) {
      if (isWorkspaceFileTooLarge(error)) throw new Error('O package.json excede o limite permitido.')
      if (!((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)) throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o package.json com segurança.')
      /* keep basic detection for missing or malformed package metadata */
    }
  }
  if (files.has('Cargo.toml')) { stack.push('Rust'); primaryLanguage = 'Rust'; commands.test = 'cargo test' }
  if (files.has('pyproject.toml') || files.has('requirements.txt')) { stack.push('Python'); primaryLanguage = 'Python'; commands.test ??= 'pytest' }
  if (files.has('go.mod')) { stack.push('Go'); primaryLanguage = 'Go'; commands.test = 'go test ./...' }
  return { name: path.basename(workspace), stack: [...new Set(stack)], primaryLanguage, commands }
}

async function recordSuggestionDecision(workspace: string, suggestion: { title: string; status: string; updatedAt: string }) {
  await ensureNocturneWorkspace(workspace)
  const memoryPath = path.join(workspace, '.nocturne', 'memory.md')
  await appendSuggestionDecision(workspace, memoryPath, { ...suggestion, title: sanitizeSuggestionTitle(suggestion.title) })
}

async function writeIfMissing(filePath: string, content: string) {
  try { await fs.promises.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
}

async function ensureProjectMetadata(filePath: string, workspace: string, project: ProjectContext) {
  let current: unknown
  try {
    current = JSON.parse((await readWorkspaceFile(filePath, workspace, WORKSPACE_READ_LIMITS.projectMetadataBytes)).content.toString('utf8'))
  } catch (error) {
    if (isWorkspaceFileTooLarge(error)) throw new Error('O metadata do projeto excede o limite permitido.')
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o metadata do projeto com segurança.')
  }
  if (isProjectContext(current) && projectContextsEqual(current, project)) return
  await atomicWrite(filePath, `${JSON.stringify(project, null, 2)}\n`)
}

function isProjectContext(value: unknown): value is ProjectContext {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectContext>
  return typeof candidate.name === 'string'
    && Array.isArray(candidate.stack)
    && candidate.stack.every((item) => typeof item === 'string')
    && typeof candidate.primaryLanguage === 'string'
    && Boolean(candidate.commands)
    && typeof candidate.commands === 'object'
    && !Array.isArray(candidate.commands)
    && Object.entries(candidate.commands).every(([key, command]) => typeof key === 'string' && typeof command === 'string')
}

function projectContextsEqual(left: ProjectContext, right: ProjectContext) {
  const leftCommands = Object.entries(left.commands)
  const rightCommands = Object.entries(right.commands)
  return left.name === right.name
    && left.primaryLanguage === right.primaryLanguage
    && left.stack.length === right.stack.length
    && left.stack.every((item, index) => item === right.stack[index])
    && leftCommands.length === rightCommands.length
    && leftCommands.every(([key, command]) => right.commands[key] === command)
}

async function atomicWrite(filePath: string, content: string) {
  await writeAtomicFile(filePath, content)
}
