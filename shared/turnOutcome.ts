/** A transport completion is not, by itself, evidence of task success. */
export function turnOutcome(value: unknown): { status: 'completed' | 'failed' | 'cancelled'; error?: { message: string } } {
  const turn = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (turn.error || turn.status === 'failed') {
    const error = turn.error as { message?: unknown } | undefined
    return { status: 'failed', error: { message: typeof error?.message === 'string' ? error.message : 'A execução do agente falhou.' } }
  }
  if (turn.status === 'cancelled' || turn.status === 'interrupted') return { status: 'cancelled' }
  if (turn.status === 'completed') return { status: 'completed' }
  return { status: 'failed', error: { message: 'O protocolo não forneceu um resultado terminal reconhecido.' } }
}
