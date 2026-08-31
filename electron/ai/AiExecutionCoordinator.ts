import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { WorkspaceModelBindings } from '../../shared/ai/bindings'
import type { NormalizedTaskInput } from '../../shared/ai/task'
import { isAgentState, type AgentState } from '../../shared/agentState'
import { isTerminalAgentState, reduceAgentLifecycle, type AgentLifecycleDetails, type AgentLifecycleEvent, type AgentRunState } from '../../shared/agentLifecycle'
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
import { IPC_CHANNELS } from '../../shared/ipc/channels'

export type ApprovalDetails = Map<string, { command?: string; risk?: string }>

interface ActiveExecution {
  runId: string
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
  cancelRequested: boolean
  sequence: number
  lifecycle: AgentRunState | null
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
    private readonly createRunId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.codex.on('event', this.onCodexEvent)
    this.codex.on('status', this.onCodexStatus)
    this.codex.on('log', this.onCodexLog)
    this.codex.on('diagnostic', this.onCodexDiagnostic)
  }

  async startCodex(input: CodexTurnInput) {
    const active = this.reserve(input.conversationId, input.workspace, input.mode, 'codex')
    const runId = active.runId
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
      if (this.active?.runId !== runId) {
        throw new Error('A execução foi cancelada antes de iniciar.')
      }
      this.active.threadId = threadId
      let interruptSent = false
      this.active.cancel = async () => {
        active.cancelRequested = true
        if (interruptSent) return
        try {
          await this.codex.interrupt(threadId)
          interruptSent = true
        } catch (error) {
          // Cancellation can race with turn/start. The post-start check below
          // retries the interrupt once Codex has registered the turn.
          if (!(error instanceof Error) || !error.message.includes('Nenhuma execução ativa')) throw error
        }
      }
      if (active.cancelRequested) {
        this.completeCancelledWithoutTurn(active)
        return
      }
      await this.codex.sendTurn(
        threadId,
        input.workspace,
        resumed ? input.prompt : input.initialPrompt,
        settings,
        input.attachments,
        input.memory,
        input.mode,
      )
      if (active.cancelRequested && !interruptSent && this.active?.runId === runId) {
        await this.codex.interrupt(threadId)
        interruptSent = true
      }
    } catch (error) {
      if (this.active?.runId === runId) {
        this.pushExecutionStatus(active, 'failed', error instanceof Error ? error.message : String(error))
        this.active = null
      }
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
    const active = this.reserve(conversationId, taskInput.workspace.id, taskInput.mode === 'review' ? 'review' : 'build', 'provider')
    const runId = active.runId
    try {
      const turn = await startAiTurn(
        this.models,
        this.providers,
        taskInput,
        bindings,
        (method, params) => this.forwardEvent(method, params, conversationId, runId),
      )
      if (this.active?.runId !== runId) {
        turn.cancel('A execução perdeu seu contexto ativo.')
        throw new Error('A execução foi cancelada antes de iniciar.')
      }
      this.active.cancel = async () => {
        active.cancelRequested = true
        turn.cancel('Execução cancelada pelo usuário.')
      }
      if (active.cancelRequested) turn.cancel('Execução cancelada pelo usuário.')
      this.pushExecutionStatus(active, 'running')
      void turn.completion
        .then((outcome) => {
          if (outcome.status === 'completed') {
            this.pushExecutionStatusIfCurrent(active, 'completed')
          } else if (outcome.status === 'cancelled') {
            this.pushExecutionStatusIfCurrent(active, 'ready', undefined, true)
          } else {
            this.pushExecutionStatusIfCurrent(active, 'failed', outcome.error?.message ?? 'A execução do Provider falhou.')
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          if (!this.isCurrentOrFinished(active)) return
          this.pushEvent('error', { message }, active)
          this.pushEvent('turn/completed', {
            turn: { id: turn.executionId, error: { message } },
          }, active)
          this.pushExecutionStatusIfCurrent(active, 'failed', message)
        })
    } catch (error) {
      if (this.active?.runId === runId) {
        this.pushExecutionStatus(active, 'failed', error instanceof Error ? error.message : String(error))
        this.active = null
      }
      throw error
    }
  }

  async cancel(conversationId: string) {
    const active = this.active
    if (!active || active.conversationId !== conversationId || active.finishing || (active.lifecycle && isTerminalAgentState(active.lifecycle.state))) {
      throw new Error('Nenhuma execução ativa nesta conversa.')
    }
    if (!this.applyLifecycle(active, {
      type: 'run.cancelRequested',
      reason: 'Execução cancelada pelo usuário.',
    })) return
    this.pushStatusForRun(active, 'cancelling')
    await active.cancel()
  }

  async resolveApproval(key: string, accepted: boolean, forSession = false) {
    if (this.active?.kind !== 'codex' || this.active.lifecycle?.state !== 'waiting-approval') {
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
    this.active = null
    this.codex.stop()
    this.approvalDetails.clear()
  }

  private reserve(conversationId: string, workspace: string, mode: AgentMode, kind: ActiveExecution['kind']) {
    if (this.disposed) throw new Error('O coordenador de execuções já foi descartado.')
    if (this.active) {
      throw new Error('Já existe uma execução em andamento. Cancele-a antes de iniciar outra.')
    }
    const active: ActiveExecution = {
      runId: this.createRunId(),
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
      cancelRequested: false,
      sequence: 0,
      lifecycle: null,
      cancel: async () => {
        active.cancelRequested = true
      },
    }
    this.active = active
    this.applyLifecycle(active, { type: 'run.started', workspace, mode })
    this.pushStatusForRun(active, 'planning')
    return active
  }

  private readonly onCodexEvent = (event: CodexEvent) => {
    const active = this.active
    if (!active || active.kind !== 'codex' || active.finishing || (active.lifecycle?.state === 'cancelling' && event.method !== 'turn/completed')) return
    const conversationId = active.conversationId
    const eventThreadId = typeof event.params.threadId === 'string' ? event.params.threadId : undefined
    if (active.threadId && eventThreadId && active.threadId !== eventThreadId) return
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
      this.applyLifecycle(active, { type: 'run.approvalRequested' })
    }
    this.forwardEvent(
      event.method,
        assessment
          ? { ...event.params, commandAssessment: assessment }
          : event.params,
      conversationId,
      active.runId,
    )
  }

  private readonly onCodexStatus = (status: { status: unknown; error?: string }) => {
    if (!isAgentState(status.status)) {
      this.logger.warn('ai', 'Estado de execução desconhecido recebido do transporte.', { status: status.status })
      return
    }
    const nextStatus = status.status
    const active = this.active
    if (!active) {
      this.pushTransportStatus(nextStatus, status.error)
      return
    }
    this.pushExecutionStatus(active, nextStatus, status.error, nextStatus === 'ready' && active.lifecycle?.state === 'cancelling')
    if (nextStatus === 'failed' && status.error && active?.kind === 'codex' && active.threadId && !active.finishing) {
      this.pushEvent('error', { message: status.error }, active)
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

  private pushEvent(method: string, params: Record<string, unknown>, active: ActiveExecution) {
    const sequence = this.nextSequence(active)
    const timestamp = this.now().toISOString()
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(IPC_CHANNELS.ai.event, {
        method,
        runId: active.runId,
        sequence,
        timestamp,
        params: {
          ...params,
          conversationId: active.conversationId,
          runId: active.runId,
          sequence,
          timestamp,
        },
      })
    }
  }

  private forwardEvent(method: string, params: Record<string, unknown>, conversationId: string, runId: string) {
    const active = this.active
    if (!active || active.runId !== runId || active.conversationId !== conversationId) return
    if (active.finishing || (active.lifecycle?.state === 'cancelling' && method !== 'turn/completed')) return
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
    this.pushEvent(method, params, active)
  }

  private async persistAndComplete(active: ActiveExecution, params: Record<string, unknown>) {
    if (this.active !== active || active.finishing) return
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
      this.applyCompletionLifecycle(active, params)
      this.pushEvent('turn/completed', { ...params, persistedMessage: persisted.message, persistenceWarning: persisted.warning }, active)
    } catch (error) {
      const warning = `A resposta não pôde ser persistida no processo principal: ${error instanceof Error ? error.message : String(error)}`
      this.logger.error('persistence', warning, error)
      this.applyLifecycle(active, { type: 'run.failed', error: warning })
      this.pushEvent('turn/completed', { ...params, persistenceWarning: warning }, active)
    } finally {
      if (this.active === active) this.active = null
    }
  }

  private pushExecutionStatusIfCurrent(active: ActiveExecution, status: AgentState, error?: string, cancelled = false) {
    if (!this.isCurrentOrFinished(active)) return
    this.pushExecutionStatus(active, status, error, cancelled)
  }

  private pushExecutionStatus(active: ActiveExecution, status: AgentState, error?: string, cancelled = false) {
    if (!this.applyStatusLifecycle(active, status, error, cancelled)) return
    this.pushStatusForRun(active, status, error)
  }

  private pushStatusForRun(active: ActiveExecution, status: AgentState, error?: string) {
    const sequence = this.nextSequence(active)
    const timestamp = this.now().toISOString()
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(IPC_CHANNELS.ai.status, {
        status,
        conversationId: active.conversationId,
        runId: active.runId,
        sequence,
        timestamp,
        ...(error ? { error } : {}),
      })
    }
  }

  private pushTransportStatus(status: AgentState, error?: string) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(IPC_CHANNELS.ai.status, {
        status,
        sequence: ++this.transportSequence,
        timestamp: this.now().toISOString(),
        ...(error ? { error } : {}),
      })
    }
  }

  private applyStatusLifecycle(active: ActiveExecution, status: AgentState, error?: string, cancelled = false) {
    if (status === 'planning' || status === 'running' || status === 'waiting-approval' || status === 'cancelling') {
      return this.applyLifecycle(active, { type: 'run.stateChanged', state: status })
    }
    if (status === 'completed') return this.applyLifecycle(active, { type: 'run.completed' })
    if (status === 'failed') return this.applyLifecycle(active, { type: 'run.failed', error: error ?? 'A execução do agente falhou.' })
    if (status === 'ready' && cancelled) return this.applyLifecycle(active, { type: 'run.cancelled', reason: error })
    return true
  }

  private applyLifecycle(active: ActiveExecution, details: AgentLifecycleDetails) {
    const event = {
      ...details,
      runId: active.runId,
      conversationId: active.conversationId,
      sequence: this.nextSequence(active),
      timestamp: this.now().toISOString(),
    } as AgentLifecycleEvent
    const transition = reduceAgentLifecycle(active.lifecycle, event)
    if (!transition.accepted) {
      this.logger.warn('ai', 'Transição do lifecycle do agente ignorada.', {
        runId: active.runId,
        conversationId: active.conversationId,
        current: active.lifecycle?.state,
        event: event.type,
        reason: transition.reason,
      })
      return false
    }
    active.lifecycle = transition.state
    return true
  }

  private isCurrentOrFinished(active: ActiveExecution) {
    return this.active === active
  }

  private applyCompletionLifecycle(active: ActiveExecution, params: Record<string, unknown>) {
    const turn = params.turn as Record<string, unknown> | undefined
    let accepted = false
    if (turn?.status === 'cancelled') {
      accepted = this.applyLifecycle(active, {
        type: 'run.cancelled',
        reason: 'Execução cancelada pelo usuário.',
      })
    } else if (turn?.status === 'failed' || turn?.error) {
      const error = turn.error as Record<string, unknown> | undefined
      accepted = this.applyLifecycle(active, {
        type: 'run.failed',
        error: typeof error?.message === 'string' ? error.message : 'A execução do agente falhou.',
      })
    } else {
      accepted = this.applyLifecycle(active, { type: 'run.completed' })
    }
    if (active.kind === 'provider' && accepted) {
      if (turn?.status === 'cancelled') this.pushStatusForRun(active, 'ready')
      else if (turn?.status === 'failed' || turn?.error) this.pushStatusForRun(active, 'failed')
      else this.pushStatusForRun(active, 'completed')
    }
  }

  private completeCancelledWithoutTurn(active: ActiveExecution) {
    if (this.active !== active || active.finishing) return
    this.applyLifecycle(active, {
      type: 'run.cancelled',
      reason: 'Execução cancelada antes do início do turno.',
    })
    this.pushStatusForRun(active, 'ready')
    this.pushEvent('turn/completed', {
      turn: { id: `cancelled-${active.runId}`, status: 'cancelled' },
    }, active)
    this.active = null
  }

  private nextSequence(active: ActiveExecution) {
    active.sequence += 1
    return active.sequence
  }

  private transportSequence = 0
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
