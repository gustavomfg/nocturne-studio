import { describe, expect, it, vi } from 'vitest'
import { AgentStateMachine, canTransition, isAgentState } from '../shared/agentState'

describe('AgentStateMachine', () => {
  it('aceita o ciclo normal de execução e cancelamento', () => {
    const machine = new AgentStateMachine()
    for (const state of ['starting', 'ready', 'running', 'cancelling', 'ready'] as const) expect(machine.transition(state)).toBe(true)
    expect(machine.state).toBe('ready')
  })
  it('rejeita transições contraditórias e registra diagnóstico', () => {
    const invalid = vi.fn(); const machine = new AgentStateMachine('disconnected', invalid)
    expect(machine.transition('running')).toBe(false)
    expect(invalid).toHaveBeenCalledWith('disconnected', 'running')
    expect(canTransition('waiting-approval', 'running')).toBe(true)
  })
  it('valida estados recebidos de fronteiras não tipadas', () => {
    expect(isAgentState('waiting-approval')).toBe(true)
    expect(isAgentState('unknown')).toBe(false)
    expect(isAgentState(null)).toBe(false)
  })
})
