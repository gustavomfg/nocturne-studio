export type AgentState = 'disconnected' | 'starting' | 'ready' | 'planning' | 'running' | 'waiting-approval' | 'cancelling' | 'completed' | 'failed'

const agentStates: ReadonlySet<string> = new Set([
  'disconnected',
  'starting',
  'ready',
  'planning',
  'running',
  'waiting-approval',
  'cancelling',
  'completed',
  'failed',
])

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && agentStates.has(value)
}

const transitions: Record<AgentState, ReadonlySet<AgentState>> = {
  disconnected: new Set(['starting']),
  starting: new Set(['ready', 'failed', 'disconnected']),
  ready: new Set(['planning', 'running', 'disconnected', 'failed']),
  planning: new Set(['running', 'waiting-approval', 'completed', 'cancelling', 'failed', 'disconnected']),
  running: new Set(['waiting-approval', 'cancelling', 'completed', 'failed', 'disconnected']),
  'waiting-approval': new Set(['running', 'cancelling', 'failed', 'disconnected']),
  cancelling: new Set(['ready', 'completed', 'failed', 'disconnected']),
  completed: new Set(['ready', 'planning', 'running', 'disconnected', 'failed']),
  failed: new Set(['starting', 'ready', 'disconnected']),
}

export function canTransition(from: AgentState, to: AgentState) {
  return from === to || transitions[from].has(to)
}

export class AgentStateMachine {
  private current: AgentState
  constructor(initial: AgentState = 'disconnected', private readonly onInvalid?: (from: AgentState, to: AgentState) => void) { this.current = initial }
  get state() { return this.current }
  transition(next: AgentState) {
    if (!canTransition(this.current, next)) { this.onInvalid?.(this.current, next); return false }
    this.current = next
    return true
  }
}
