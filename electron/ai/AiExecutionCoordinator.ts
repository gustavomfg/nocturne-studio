import type { BrowserWindow } from 'electron'
import type { WorkspaceModelBindings } from '../../shared/ai/bindings'
import type { NormalizedTaskInput } from '../../shared/ai/task'
import type { AgentMode, AppSettings } from '../../shared/types'
import { PERSISTENCE_LIMITS } from '../../shared/constants'
import { assessCommand } from '../security/ExecutionPolicy'
import type { Logger } from '../logging/Logger'
import { CodexClient } from '../codex/CodexClient'
import type { CodexEvent } from '../codex/protocol'
import type { ModelRegistry } from './ModelRegistry'
import type { ProviderRegistry } from './ProviderRegistry'
import { startAiTurn } from './executeAiTurn'
import type { CompletedTurnSnapshot, PersistedTurn } from './TurnPersistence'

export type ApprovalDetails = Map<string, { command?: string; risk?: string }>

interface ActiveExecution {
  conversationId: string
  workspace: string
  mode: AgentMode
  kind: 'codex' | 'provider'
  threadId?: string
  content: string
  diff: string
  files: string[]
  plan: unknown[]
  planExplanation: string
  finishing: boolean
  cancel(): Promise<void>
}

interface CodexTurnInput {
  conversationId: string
  workspace: string
  prompt: string
  initialPrompt: string
  attachments: string[]
  memory: string
  mode: AgentMode
  settings: AppSettings
  threadId?: string | null
}

export class AiExecutionCoordinator {
  private readonly codex = new CodexClient()
  private active: ActiveExecution | null = null
  private disposed = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly models: ModelRegistry,
    private readonly providers: ProviderRegistry,
    private readonly logger: Logger,
    private readonly approvalDetails: ApprovalDetails,
    private readonly finalizeTurn: (snapshot: CompletedTurnSnapshot) => PersistedTurn | Promise<PersistedTurn>,
    private readonly persistCodexThread: (conversationId: string, threadId: string) => void = () => undefined,
  ) {
    this.codex.on('event', this.onCodexEvent)
    this.codex.on('status', this.onCodexStatus)
    this.codex.on('log', this.onCodexLog)
    this.codex.on('diagnostic', this.onCodexDiagnostic)
  }

  async startCodex(input: CodexTurnInput) {
    this.reserve(input.conversationId, input.workspace, input.mode, 'codex')
    try {
      const settings = input.settings as unknown as Record<string, string>
      let resumed = false
      let threadId = input.threadId ?? ''
      if (threadId) {
        try {
          await this.codex.resumeThread(threadId, input.workspace, settings, input.memory)
          resumed = true
        } catch (error) {
          this.logger.warn('codex', 'A thread persistida não pôde ser retomada; uma nova sessão será criada com o histórico local.', {
            conversationId: input.conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
          threadId = ''
        }
      }
      if (!threadId) {
        threadId = await this.codex.createThread(input.workspace, settings, input.memory)
        this.persistCodexThread(input.conversationId, threadId)
      }
      if (!this.active || this.active.conversationId !== input.conversationId) {
        throw new Error('A execução foi cancelada antes de iniciar.')
      }
      this.active.threadId = threadId
      this.active.cancel = async () => this.codex.interrupt(threadId)
      await this.codex.sendTurn(
        threadId,
        input.workspace,
        resumed ? input.prompt : input.initialPrompt,
        settings,
        input.attachments,
        input.memory,
        input.mode,
      )
    } catch (error) {
      this.active = null
      throw error
    }
  }

  listCodexModels() {
    return this.codex.listModels()
  }

  checkCodexProtocol() {
    return this.codex.checkProtocol()
  }

  async startProvider(
    conversationId: string,
    taskInput: NormalizedTaskInput,
    bindings: WorkspaceModelBindings,
  ) {
    this.reserve(conversationId, taskInput.workspace.id, taskInput.mode === 'review' ? 'review' : 'build', 'provider')
    this.pushStatus('planning', conversationId)
    try {
      const turn = await startAiTurn(
        this.models,
        this.providers,
        taskInput,
        bindings,
        (method, params) => this.forwardEvent(method, params, conversationId),
      )
      if (!this.active || this.active.conversationId !== conversationId) {
        turn.cancel('A execução perdeu seu contexto ativo.')
        throw new Error('A execução foi cancelada antes de iniciar.')
      }
      this.active.cancel = async () => {
        turn.cancel('Execução cancelada pelo usuário.')
      }
      this.pushStatus('running', conversationId)
      void turn.completion
        .then((outcome) => {
          if (outcome.status === 'completed') {
            this.pushStatus('completed', conversationId)
          } else if (outcome.status === 'cancelled') {
            this.pushStatus('ready', conversationId)
          } else {
            this.pushStatus('failed', conversationId, outcome.error?.message ?? 'A execução do Provider falhou.')
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          this.pushEvent('error', { message }, conversationId)
          this.pushEvent('turn/completed', {
            turn: { id: turn.executionId, error: { message } },
          }, conversationId)
          this.pushStatus('failed', conversationId, message)
        })
    } catch (error) {
      this.active = null
      this.pushStatus(
        'failed',
        conversationId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  async cancel(conversationId: string) {
    if (!this.active || this.active.conversationId !== conversationId) {
      throw new Error('Nenhuma execução ativa nesta conversa.')
    }
    this.pushStatus('cancelling', conversationId)
    await this.active.cancel()
  }

  async resolveApproval(key: string, accepted: boolean, forSession = false) {
    if (this.active?.kind !== 'codex') {
      throw new Error('Não existe uma execução Codex aguardando aprovação.')
    }
    await this.codex.resolveApproval(key, accepted, forSession)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.codex.off('event', this.onCodexEvent)
    this.codex.off('status', this.onCodexStatus)
    this.codex.off('log', this.onCodexLog)
    this.codex.off('diagnostic', this.onCodexDiagnostic)
    this.codex.stop()
    this.active = null
    this.approvalDetails.clear()
  }

  private reserve(conversationId: string, workspace: string, mode: AgentMode, kind: ActiveExecution['kind']) {
    if (this.active) {
      throw new Error('Já existe uma execução em andamento. Cancele-a antes de iniciar outra.')
    }
    this.active = {
      conversationId,
      workspace,
      mode,
      kind,
      content: '',
      diff: '',
      files: [],
      plan: [],
      planExplanation: '',
      finishing: false,
      cancel: async () => {
        throw new Error('A execução ainda está iniciando e não pode ser cancelada neste instante.')
      },
    }
  }

  private readonly onCodexEvent = (event: CodexEvent) => {
    const conversationId = this.active?.conversationId
    if (!conversationId) return
    const command = event.params.command
    const assessment = typeof command === 'string' || Array.isArray(command)
      ? assessCommand(command as string | string[])
      : undefined
    const approvalKey = typeof event.params.approvalKey === 'string'
      ? event.params.approvalKey
      : undefined
    if (approvalKey) {
      this.approvalDetails.set(approvalKey, {
        command: Array.isArray(command)
          ? command.join(' ')
          : typeof command === 'string' ? command : undefined,
        risk: assessment?.risk,
      })
    }
    this.forwardEvent(
      event.method,
      assessment
        ? { ...event.params, commandAssessment: assessment }
        : event.params,
      conversationId,
    )
  }

  private readonly onCodexStatus = (status: { status: string; error?: string }) => {
    this.pushStatus(status.status, this.active?.conversationId, status.error)
    const active = this.active
    if (status.status === 'failed' && status.error && active?.kind === 'codex' && active.threadId && !active.finishing) {
      this.pushEvent('error', { message: status.error }, active.conversationId)
      void this.persistAndComplete(active, {
        threadId: active.threadId,
        turn: {
          id: `failed-${Date.now()}`,
          status: 'failed',
          error: { message: `${status.error} A sessão foi preservada e será retomada na próxima tentativa.` },
        },
      })
    }
  }

  private readonly onCodexLog = (entry: unknown) => {
    const stream = entry && typeof entry === 'object' && (entry as { stream?: unknown }).stream === 'stderr' ? 'stderr' : 'stdout'
    const line = entry && typeof entry === 'object' && typeof (entry as { line?: unknown }).line === 'string' ? (entry as { line: string }).line : ''
    this.logger.debug('codex', 'Tráfego do App Server recebido', { stream, bytes: Buffer.byteLength(line, 'utf8') })
  }

  private readonly onCodexDiagnostic = (entry: unknown) => {
    const level = entry && typeof entry === 'object'
      ? (entry as { level?: unknown }).level
      : undefined
    if (level === 'warn' || level === 'error') {
      this.logger.warn('codex', 'Diagnóstico do agente', entry)
    } else {
      this.logger.info('codex', 'Diagnóstico do agente', entry)
    }
  }

  private pushEvent(method: string, params: Record<string, unknown>, conversationId: string) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('ai:event', {
        method,
        params: { ...params, conversationId },
      })
    }
  }

  private forwardEvent(method: string, params: Record<string, unknown>, conversationId: string) {
    const active = this.active
    if (!active || active.conversationId !== conversationId) return
    if (method === 'item/agentMessage/delta') active.content = `${active.content}${String(params.delta ?? '')}`.slice(0, PERSISTENCE_LIMITS.assistantCharacters)
    if (method === 'turn/diff/updated') active.diff = String(params.diff ?? '').slice(-PERSISTENCE_LIMITS.metadataCharacters)
    if (method === 'turn/plan/updated') {
      active.plan = Array.isArray(params.plan) ? params.plan.slice(-100) : []
      active.planExplanation = String(params.explanation ?? '').slice(-20_000)
    }
    active.files = [...new Set([...active.files, ...eventFiles(method, params)])].slice(-300)
    if (method === 'turn/completed') {
      void this.persistAndComplete(active, params)
      return
    }
    this.pushEvent(method, params, conversationId)
  }

  private async persistAndComplete(active: ActiveExecution, params: Record<string, unknown>) {
    if (active.finishing) return
    active.finishing = true
    try {
      const persisted = await this.finalizeTurn({
        conversationId: active.conversationId,
        workspace: active.workspace,
        mode: active.mode,
        content: active.content,
        diff: active.diff,
        files: active.files,
        plan: active.plan,
        planExplanation: active.planExplanation,
      })
      this.pushEvent('turn/completed', { ...params, persistedMessage: persisted.message, persistenceWarning: persisted.warning }, active.conversationId)
    } catch (error) {
      const warning = `A resposta não pôde ser persistida no processo principal: ${error instanceof Error ? error.message : String(error)}`
      this.logger.error('persistence', warning, error)
      this.pushEvent('turn/completed', { ...params, persistenceWarning: warning }, active.conversationId)
    } finally {
      if (this.active === active) this.active = null
    }
  }

  private pushStatus(status: string, conversationId?: string, error?: string) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('ai:status', { status, conversationId, error })
    }
  }
}

function eventFiles(method: string, params: Record<string, unknown>) {
  if (method === 'fs/changed' && Array.isArray(params.changedPaths)) return params.changedPaths.map(String)
  if (method !== 'item/completed') return []
  const item = params.item as Record<string, unknown> | undefined
  if (!item || !Array.isArray(item.changes)) return []
  return item.changes.flatMap((change) => {
    const filePath = change && typeof change === 'object' ? (change as Record<string, unknown>).path : undefined
    return typeof filePath === 'string' ? [filePath] : []
  })
}
