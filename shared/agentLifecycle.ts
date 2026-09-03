import type { AgentState } from './agentState'
import type { AgentMode } from './suggestions'

export type AgentExecutionState =
  | 'planning'
  | 'running'
  | 'waiting-approval'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AgentActiveState = Exclude<AgentExecutionState, 'completed' | 'failed' | 'cancelled'>
export type AgentTerminalState = Extract<AgentExecutionState, 'completed' | 'failed' | 'cancelled'>

export interface AgentStatusEvent {
  status: AgentState
  conversationId?: string
  runId?: string
  executionId?: string
  sequence: number
  timestamp: string
  error?: string
}

export interface AgentRunState {
  runId: string
  conversationId: string
  executionId?: string
  workspace: string
  mode: AgentMode
  state: AgentExecutionState
  sequence: number
  startedAt: string
  updatedAt: string
  error?: string
}

interface AgentLifecycleEnvelope {
  runId: string
  conversationId: string
  sequence: number
  timestamp: string
}

export type AgentLifecycleDetails =
  | {
    type: 'run.started'
    workspace: string
    mode: AgentMode
    executionId?: string
  }
  | {
    type: 'run.stateChanged'
    state: AgentActiveState
  }
  | {
    type: 'run.approvalRequested'
  }
  | {
    type: 'run.cancelRequested'
    reason?: string
  }
  | {
    type: 'run.completed'
  }
  | {
    type: 'run.failed'
    error: string
  }
  | {
    type: 'run.cancelled'
    reason?: string
  }

export type AgentLifecycleEvent = AgentLifecycleEnvelope & AgentLifecycleDetails

export type AgentLifecycleTransition =
  | { accepted: true; state: AgentRunState }
  | { accepted: false; reason: 'missing-run' | 'different-run' | 'out-of-order' | 'invalid-transition' }

const transitions: Record<AgentExecutionState, ReadonlySet<AgentExecutionState>> = {
  planning: new Set(['planning', 'running', 'waiting-approval', 'cancelling', 'completed', 'failed', 'cancelled']),
  running: new Set(['running', 'waiting-approval', 'cancelling', 'completed', 'failed', 'cancelled']),
  'waiting-approval': new Set(['waiting-approval', 'running', 'cancelling', 'failed', 'cancelled']),
  cancelling: new Set(['cancelling', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

export function isTerminalAgentState(state: AgentExecutionState): state is AgentTerminalState {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

export function reduceAgentLifecycle(current: AgentRunState | null, event: AgentLifecycleEvent): AgentLifecycleTransition {
  if (event.type === 'run.started') {
    if (current) return { accepted: false, reason: 'different-run' }
    return {
      accepted: true,
      state: {
        runId: event.runId,
        conversationId: event.conversationId,
        ...(event.executionId ? { executionId: event.executionId } : {}),
        workspace: event.workspace,
        mode: event.mode,
        state: 'planning',
        sequence: event.sequence,
        startedAt: event.timestamp,
        updatedAt: event.timestamp,
      },
    }
  }

  if (!current) return { accepted: false, reason: 'missing-run' }
  if (current.runId !== event.runId || current.conversationId !== event.conversationId) {
    return { accepted: false, reason: 'different-run' }
  }
  if (event.sequence <= current.sequence) return { accepted: false, reason: 'out-of-order' }

  const nextState = lifecycleEventState(event)
  if (!transitions[current.state].has(nextState)) {
    return { accepted: false, reason: 'invalid-transition' }
  }

  return {
    accepted: true,
    state: {
      ...current,
      state: nextState,
      sequence: event.sequence,
      updatedAt: event.timestamp,
      ...(event.type === 'run.failed' ? { error: event.error } : {}),
    },
  }
}

function lifecycleEventState(event: Exclude<AgentLifecycleEvent, { type: 'run.started' }>): AgentExecutionState {
  if (event.type === 'run.stateChanged') return event.state
  if (event.type === 'run.approvalRequested') return 'waiting-approval'
  if (event.type === 'run.cancelRequested') return 'cancelling'
  if (event.type === 'run.completed') return 'completed'
  if (event.type === 'run.failed') return 'failed'
  return 'cancelled'
}
