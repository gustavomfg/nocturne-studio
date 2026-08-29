import { randomUUID } from 'node:crypto'
import type { WorkspaceModelBindings } from '../../shared/ai/bindings'
import type { NormalizedExecutionEvent, NormalizedProviderError } from '../../shared/ai/execution'
import type {
  ExecutionOutcome,
  ProviderExecutionResult,
} from '../../shared/ai/providerExecution'
import {
  providerExecutionRequestSchema,
  providerExecutionResultSchema,
  providerStreamPayloadSchema,
} from '../../shared/ai/providerExecutionSchemas'
import type { NormalizedTask } from '../../shared/ai/task'
import { normalizedTaskSchema } from '../../shared/ai/taskSchemas'
import { ExecutionEventStream } from './ExecutionEventStream'
import { ModelResolver } from './ModelResolver'
import { ProviderExecutionError } from './ProviderExecutionError'
import { ProviderRegistry } from './ProviderRegistry'

export interface ExecutionHandle {
  executionId: string
  completion: Promise<ExecutionOutcome>
  cancel(reason?: string): boolean
}

export class AIOrchestrator {
  constructor(
    private readonly resolver: ModelResolver,
    private readonly providers: ProviderRegistry,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(
    taskInput: unknown,
    bindings: WorkspaceModelBindings,
    onEvent?: (event: NormalizedExecutionEvent) => void,
  ): Promise<ExecutionHandle> {
    const task = normalizedTaskSchema.parse(taskInput) as NormalizedTask
    const resolved = await this.resolver.resolve(task, bindings)
    const adapter = this.providers.resolve(resolved.model.providerId)
    const executionId = this.createId()
    const controller = new AbortController()
    const stream = new ExecutionEventStream(executionId, onEvent, this.now)
    stream.emit({
      type: 'execution.started',
      providerId: resolved.model.providerId,
      modelId: resolved.model.modelId,
    })

    let settled = false
    let cancellationReason = 'Execução cancelada pelo usuário.'
    const completion = this.run(
      executionId,
      task,
      resolved.model,
      adapter,
      controller.signal,
      stream,
      () => cancellationReason,
    ).finally(() => {
      settled = true
    })

    return {
      executionId,
      completion,
      cancel(reason = cancellationReason) {
        if (settled || controller.signal.aborted) return false
        cancellationReason = reason
        controller.abort()
        return true
      },
    }
  }

  private async run(
    executionId: string,
    task: NormalizedTask,
    model: ExecutionOutcome['model'],
    adapter: ReturnType<ProviderRegistry['resolve']>,
    signal: AbortSignal,
    stream: ExecutionEventStream,
    cancellationReason: () => string,
  ): Promise<ExecutionOutcome> {
    try {
      const request = providerExecutionRequestSchema.parse({
        executionId,
        task,
        model,
      })
      const rawResult = await adapter.execute(request, {
        signal,
        emit(payload) {
          if (stream.status === 'terminal') return
          const normalized = providerStreamPayloadSchema.parse(payload)
          stream.emit(normalized)
        },
      })
      if (signal.aborted) return cancelledOutcome(executionId, model, stream, cancellationReason())

      const result = providerExecutionResultSchema.parse(rawResult) as ProviderExecutionResult
      stream.emit({
        type: 'execution.completed',
        finishReason: result.finishReason,
      })
      return {
        executionId,
        status: 'completed',
        model,
        finishReason: result.finishReason,
      }
    } catch (error) {
      if (signal.aborted) return cancelledOutcome(executionId, model, stream, cancellationReason())
      const normalized = normalizeExecutionError(error)
      stream.emit({ type: 'execution.failed', error: normalized })
      return {
        executionId,
        status: 'failed',
        model,
        error: normalized,
      }
    }
  }
}

function cancelledOutcome(
  executionId: string,
  model: ExecutionOutcome['model'],
  stream: ExecutionEventStream,
  reason: string,
): ExecutionOutcome {
  stream.emit({ type: 'execution.cancelled', reason })
  return { executionId, status: 'cancelled', model }
}

function normalizeExecutionError(error: unknown): NormalizedProviderError {
  if (error instanceof ProviderExecutionError) return error.normalized
  return {
    code: 'invalid-response',
    message: 'O Provider retornou uma resposta inválida.',
    retryable: false,
  }
}
