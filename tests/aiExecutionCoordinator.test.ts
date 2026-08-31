import { describe, expect, it, vi } from 'vitest'
import { AiExecutionCoordinator } from '../electron/ai/AiExecutionCoordinator'
import { ModelRegistry } from '../electron/ai/ModelRegistry'
import { ProviderRegistry, type ProviderAdapter } from '../electron/ai/ProviderRegistry'
import type { WorkspaceModelBindings } from '../shared/ai/bindings'
import type { ModelDescriptor } from '../shared/ai/model'
import type { NormalizedTaskInput } from '../shared/ai/task'
import type { ProviderExecutionControl, ProviderExecutionRequest } from '../shared/ai/providerExecution'
import { FakeProviderAdapter } from './helpers/FakeProviderAdapter'
import { providerDefinition } from './helpers/providerDefinition'

const descriptor: ModelDescriptor = { providerId: 'fake', modelId: 'model', displayName: 'Fake', source: 'local', capabilities: ['chat', 'streaming'], availability: 'available' }
const bindings: WorkspaceModelBindings = { workspaceId: '/workspace', defaultBinding: { providerId: 'fake', modelId: 'model' } }
const task: NormalizedTaskInput = {
  workspace: { id: '/workspace', name: 'Workspace' }, intent: 'Analise.', mode: 'review', messages: [], context: [], constraints: [],
  requirements: ['chat', 'streaming'], selection: { type: 'workspace-default' }, output: { format: 'markdown' }, permissions: { workspaceAccess: 'read-only' }, tools: [],
}

class ControlledProviderAdapter implements ProviderAdapter {
  readonly definition = { ...providerDefinition('fake', 'local'), displayName: 'Fake Provider' }
  readonly controls: ProviderExecutionControl[] = []
  private readonly releases: Array<() => void> = []

  constructor(readonly models: ModelDescriptor[], private readonly waitForCancellation = false) {}

  getAvailability() { return { status: 'available' as const } }
  listModels() { return this.models }

  async execute(_request: ProviderExecutionRequest, control: ProviderExecutionControl) {
    const index = this.controls.push(control) - 1
    if (this.waitForCancellation) {
      await new Promise<void>((resolve) => control.signal.addEventListener('abort', () => resolve(), { once: true }))
      control.emit({ type: 'message.delta', messageId: `late-${index}`, delta: 'evento atrasado' })
    } else {
      await new Promise<void>((resolve) => this.releases[index] = resolve)
    }
    return { finishReason: 'stop' as const }
  }

  release(index: number) { this.releases[index]?.() }
  emit(index: number) { this.controls[index]?.emit({ type: 'message.delta', messageId: `late-${index}`, delta: 'evento atrasado' }) }
}

function testWindow() {
  const sent: Array<{ channel: string; payload: Record<string, unknown> }> = []
  const win = { isDestroyed: () => false, webContents: { send: (channel: string, payload: Record<string, unknown>) => sent.push({ channel, payload }) } }
  return { sent, win }
}

function testLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('AiExecutionCoordinator', () => {
  it('persiste a resposta antes de publicar a conclusão ao renderer', async () => {
    const { sent, win } = testWindow()
    const models = new ModelRegistry(); models.register(descriptor)
    const providers = new ProviderRegistry(); providers.register(new FakeProviderAdapter([descriptor], { events: [{ type: 'message.delta', messageId: 'assistant', delta: 'Resposta durável.' }] }))
    const finalize = vi.fn(() => ({ message: { id: 'message-1', conversationId: 'conversation-1', role: 'assistant' as const, content: 'Resposta durável.', metadata: null, createdAt: '2026-07-29T10:00:00.000Z' } }))
    const logger = testLogger()
    const coordinator = new AiExecutionCoordinator(win as never, models, providers, logger as never, new Map(), finalize)
    await coordinator.startProvider('conversation-1', task, bindings)
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    const completion = sent.find(({ channel, payload }) => channel === 'ai:event' && payload.method === 'turn/completed')
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-1', content: 'Resposta durável.', mode: 'review' }))
    expect(completion?.payload).toMatchObject({ params: { persistedMessage: { id: 'message-1', content: 'Resposta durável.' } } })
    coordinator.dispose()
  })

  it('publica identificador de execução e sequência monotônica em status e eventos', async () => {
    const { sent, win } = testWindow()
    const models = new ModelRegistry(); models.register(descriptor)
    const providers = new ProviderRegistry(); providers.register(new FakeProviderAdapter([descriptor], { events: [{ type: 'message.delta', messageId: 'assistant', delta: 'Resposta.' }] }))
    const coordinator = new AiExecutionCoordinator(win as never, models, providers, testLogger() as never, new Map(), vi.fn(() => ({ message: { id: 'message-2', conversationId: 'conversation-1', role: 'assistant' as const, content: 'Resposta.', metadata: null, createdAt: '2026-07-29T10:00:00.000Z' } })), undefined, () => 'run-1', () => new Date('2026-07-29T10:00:00.000Z'))

    await coordinator.startProvider('conversation-1', task, bindings)
    await vi.waitFor(() => expect(sent.some(({ channel, payload }) => channel === 'ai:event' && payload.method === 'turn/completed')).toBe(true))

    const updates = sent.filter(({ payload }) => payload.runId === 'run-1')
    expect(updates.length).toBeGreaterThan(2)
    expect(new Set(updates.map(({ payload }) => payload.runId))).toEqual(new Set(['run-1']))
    const sequences = updates.map(({ payload }) => payload.sequence)
    expect(sequences).toEqual([...sequences].sort((left, right) => Number(left) - Number(right)))
    expect(sequences.every((value, index) => index === 0 || Number(value) > Number(sequences[index - 1]))).toBe(true)
    expect(sent.find(({ channel }) => channel === 'ai:status')?.payload).toMatchObject({ status: 'planning', runId: 'run-1' })
    coordinator.dispose()
  })

  it('publica erro terminal e libera a conversa para uma nova tentativa', async () => {
    const { sent, win } = testWindow()
    const models = new ModelRegistry(); models.register(descriptor)
    const providers = new ProviderRegistry(); providers.register(new FakeProviderAdapter([descriptor], { error: { code: 'rate-limited', message: 'Limite temporário.', retryable: true } }))
    const finalize = vi.fn((snapshot: { conversationId: string }) => ({ message: { id: `failed-${finalize.mock.calls.length + 1}`, conversationId: snapshot.conversationId, role: 'assistant' as const, content: '', metadata: null, createdAt: '2026-07-29T10:00:00.000Z' } }))
    const coordinator = new AiExecutionCoordinator(win as never, models, providers, testLogger() as never, new Map(), finalize, undefined, () => `run-error-${finalize.mock.calls.length + 1}`, () => new Date('2026-07-29T10:00:00.000Z'))

    await coordinator.startProvider('conversation-1', task, bindings)
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    expect(sent).toContainEqual(expect.objectContaining({ channel: 'ai:event', payload: expect.objectContaining({ method: 'error', params: expect.objectContaining({ message: 'Limite temporário.' }) }) }))
    expect(sent).toContainEqual(expect.objectContaining({ channel: 'ai:event', payload: expect.objectContaining({ method: 'turn/completed', params: expect.objectContaining({ turn: expect.objectContaining({ status: 'failed' }) }) }) }))

    await coordinator.startProvider('conversation-1', task, bindings)
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(2))
    expect(new Set(sent.filter(({ channel }) => channel === 'ai:event').map(({ payload }) => payload.runId))).toEqual(new Set(['run-error-1', 'run-error-2']))
    coordinator.dispose()
  })

  it('ignora deltas emitidos depois do cancelamento e conclui o run como cancelado', async () => {
    const { sent, win } = testWindow()
    const adapter = new ControlledProviderAdapter([descriptor], true)
    const models = new ModelRegistry(); models.register(descriptor)
    const providers = new ProviderRegistry(); providers.register(adapter)
    const finalize = vi.fn(() => ({ message: { id: 'cancelled-message', conversationId: 'conversation-1', role: 'assistant' as const, content: '', metadata: null, createdAt: '2026-07-29T10:00:00.000Z' } }))
    const coordinator = new AiExecutionCoordinator(win as never, models, providers, testLogger() as never, new Map(), finalize, undefined, () => 'run-cancel', () => new Date('2026-07-29T10:00:00.000Z'))

    await coordinator.startProvider('conversation-1', task, bindings)
    await coordinator.cancel('conversation-1')
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())

    expect(sent.some(({ channel, payload }) => channel === 'ai:event' && payload.method === 'item/agentMessage/delta' && payload.params && (payload.params as Record<string, unknown>).delta === 'evento atrasado')).toBe(false)
    expect(sent.some(({ channel, payload }) => channel === 'ai:status' && payload.status === 'cancelling')).toBe(true)
    expect(sent.some(({ channel, payload }) => channel === 'ai:status' && payload.status === 'ready')).toBe(true)
    coordinator.dispose()
  })

  it('preserva cancelamento solicitado enquanto o provider ainda está sendo preparado', async () => {
    const { sent, win } = testWindow()
    const adapter = new ControlledProviderAdapter([descriptor], true)
    const models = new ModelRegistry(); models.register(descriptor)
    const providers = new ProviderRegistry(); providers.register(adapter)
    const finalize = vi.fn(() => ({ message: { id: 'preparation-cancelled', conversationId: 'conversation-1', role: 'assistant' as const, content: '', metadata: null, createdAt: '2026-07-29T10:00:00.000Z' } }))
    const coordinator = new AiExecutionCoordinator(win as never, models, providers, testLogger() as never, new Map(), finalize, undefined, () => 'run-preparation-cancel', () => new Date('2026-07-29T10:00:00.000Z'))

    const starting = coordinator.startProvider('conversation-1', task, bindings)
    await coordinator.cancel('conversation-1')
    await starting
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())

    expect(sent.some(({ channel, payload }) => channel === 'ai:status' && payload.status === 'cancelling')).toBe(true)
    expect(sent.some(({ channel, payload }) => channel === 'ai:status' && payload.status === 'ready')).toBe(true)
    coordinator.dispose()
  })

  it('não encaminha evento atrasado de um run antigo para um novo run da mesma conversa', async () => {
    const { sent, win } = testWindow()
    const adapter = new ControlledProviderAdapter([descriptor])
    const models = new ModelRegistry(); models.register(descriptor)
    const providers = new ProviderRegistry(); providers.register(adapter)
    const finalize = vi.fn((snapshot: { conversationId: string }) => ({ message: { id: `message-${finalize.mock.calls.length + 1}`, conversationId: snapshot.conversationId, role: 'assistant' as const, content: '', metadata: null, createdAt: '2026-07-29T10:00:00.000Z' } }))
    let runNumber = 0
    const coordinator = new AiExecutionCoordinator(win as never, models, providers, testLogger() as never, new Map(), finalize, undefined, () => `run-${++runNumber}`, () => new Date('2026-07-29T10:00:00.000Z'))

    await coordinator.startProvider('conversation-1', task, bindings)
    adapter.release(0)
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    await coordinator.startProvider('conversation-1', task, bindings)
    adapter.emit(0)

    expect(sent.some(({ channel, payload }) => channel === 'ai:event' && payload.runId === 'run-2' && payload.method === 'item/agentMessage/delta')).toBe(false)
    adapter.release(1)
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(2))
    coordinator.dispose()
  })
})
