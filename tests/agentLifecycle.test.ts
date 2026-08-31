import { describe, expect, it } from 'vitest'
import { reduceAgentLifecycle, type AgentLifecycleEvent, type AgentRunState } from '../shared/agentLifecycle'

const started: AgentLifecycleEvent = {
  type: 'run.started',
  runId: 'run-1',
  conversationId: 'conversation-1',
  workspace: '/workspace',
  mode: 'build',
  sequence: 0,
  timestamp: '2026-08-29T12:00:00.000Z',
}

function event(overrides: Partial<Extract<AgentLifecycleEvent, { type: 'run.stateChanged' }>>): AgentLifecycleEvent {
  return {
    type: 'run.stateChanged',
    runId: 'run-1',
    conversationId: 'conversation-1',
    state: 'running',
    sequence: 1,
    timestamp: '2026-08-29T12:00:01.000Z',
    ...overrides,
  }
}

describe('Agent lifecycle contract', () => {
  it('cria uma execução e aceita o caminho de execução até sucesso', () => {
    const first = reduceAgentLifecycle(null, started)
    expect(first.accepted).toBe(true)
    if (!first.accepted) return

    const running = reduceAgentLifecycle(first.state, event({ state: 'running' }))
    expect(running).toMatchObject({ accepted: true, state: { state: 'running', sequence: 1 } })
    if (!running.accepted) return

    const completed = reduceAgentLifecycle(running.state, {
      type: 'run.completed',
      runId: 'run-1',
      conversationId: 'conversation-1',
      sequence: 2,
      timestamp: '2026-08-29T12:00:02.000Z',
    })
    expect(completed).toMatchObject({ accepted: true, state: { state: 'completed', sequence: 2 } })
  })

  it('rejeita eventos de outra execução, atrasados e após terminalidade', () => {
    const current: AgentRunState = {
      runId: 'run-1', conversationId: 'conversation-1', workspace: '/workspace', mode: 'review',
      state: 'completed', sequence: 4, startedAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:04.000Z',
    }
    expect(reduceAgentLifecycle(current, event({ runId: 'run-2', sequence: 5 }))).toEqual({ accepted: false, reason: 'different-run' })
    expect(reduceAgentLifecycle(current, event({ sequence: 4 }))).toEqual({ accepted: false, reason: 'out-of-order' })
    expect(reduceAgentLifecycle(current, { type: 'run.completed', runId: 'run-1', conversationId: 'conversation-1', sequence: 5, timestamp: '2026-08-29T12:00:05.000Z' })).toEqual({ accepted: false, reason: 'invalid-transition' })
  })

  it('torna cancelamento, erro e approval estados explícitos', () => {
    const first = reduceAgentLifecycle(null, started)
    if (!first.accepted) throw new Error('run.started deveria ser aceito')
    const approval = reduceAgentLifecycle(first.state, {
      type: 'run.approvalRequested', runId: 'run-1', conversationId: 'conversation-1', sequence: 1, timestamp: '2026-08-29T12:00:01.000Z',
    })
    expect(approval).toMatchObject({ accepted: true, state: { state: 'waiting-approval' } })
    if (!approval.accepted) return
    const cancel = reduceAgentLifecycle(approval.state, {
      type: 'run.cancelRequested', runId: 'run-1', conversationId: 'conversation-1', sequence: 2, timestamp: '2026-08-29T12:00:02.000Z', reason: 'user',
    })
    expect(cancel).toMatchObject({ accepted: true, state: { state: 'cancelling' } })
  })

  it('fecha erro e cancelamento como estados terminais sem aceitar eventos posteriores', () => {
    const first = reduceAgentLifecycle(null, started)
    if (!first.accepted) throw new Error('run.started deveria ser aceito')

    const failed = reduceAgentLifecycle(first.state, event({ state: 'running' }))
    if (!failed.accepted) throw new Error('run.stateChanged deveria ser aceito')
    const error = reduceAgentLifecycle(failed.state, {
      type: 'run.failed', runId: 'run-1', conversationId: 'conversation-1', sequence: 2,
      timestamp: '2026-08-29T12:00:02.000Z', error: 'Falha reproduzível.',
    })
    expect(error).toMatchObject({ accepted: true, state: { state: 'failed', error: 'Falha reproduzível.' } })
    if (!error.accepted) return
    expect(reduceAgentLifecycle(error.state, {
      type: 'run.cancelRequested', runId: 'run-1', conversationId: 'conversation-1', sequence: 3,
      timestamp: '2026-08-29T12:00:03.000Z',
    })).toEqual({ accepted: false, reason: 'invalid-transition' })

    const cancelling = reduceAgentLifecycle(first.state, {
      type: 'run.cancelRequested', runId: 'run-1', conversationId: 'conversation-1', sequence: 4,
      timestamp: '2026-08-29T12:00:04.000Z',
    })
    if (!cancelling.accepted) throw new Error('run.cancelRequested deveria ser aceito')
    const cancelled = reduceAgentLifecycle(cancelling.state, {
      type: 'run.cancelled', runId: 'run-1', conversationId: 'conversation-1', sequence: 5,
      timestamp: '2026-08-29T12:00:05.000Z', reason: 'user',
    })
    expect(cancelled).toMatchObject({ accepted: true, state: { state: 'cancelled' } })
  })
})
