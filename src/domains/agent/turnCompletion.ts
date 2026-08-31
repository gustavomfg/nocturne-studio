export type TurnCompletionStatus = 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface TurnCompletion {
  id: string | null
  status: TurnCompletionStatus
  hasError: boolean
  errorMessage: string | null
  persistenceWarning: string | null
  persistedMessage: unknown
}

export function parseTurnCompletion(params: Record<string, unknown>): TurnCompletion {
  const turn = asRecord(params.turn)
  const rawStatus = turn?.status
  const status = rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled'
    ? rawStatus
    : 'unknown'
  const error = asRecord(turn?.error)
  const hasError = turn?.error !== undefined && turn.error !== null
  return {
    id: typeof turn?.id === 'string' || typeof turn?.id === 'number' ? String(turn.id) : null,
    status,
    hasError,
    errorMessage: typeof error?.message === 'string' ? error.message : null,
    persistenceWarning: typeof params.persistenceWarning === 'string' ? params.persistenceWarning : null,
    persistedMessage: params.persistedMessage,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
