import { describe, expect, it } from 'vitest'
import { parseTurnCompletion } from '../src/domains/agent/turnCompletion'

describe('turn completion contract', () => {
  it('normaliza uma conclusão persistida', () => {
    expect(parseTurnCompletion({ turn: { id: 'turn-1', status: 'completed' }, persistedMessage: { id: 'message-1' } })).toEqual({
      id: 'turn-1', status: 'completed', hasError: false, errorMessage: null, persistenceWarning: null, persistedMessage: { id: 'message-1' },
    })
  })

  it('preserva erro e aviso de persistência como sinais distintos', () => {
    expect(parseTurnCompletion({ turn: { id: 2, error: { message: 'Falhou.' } }, persistenceWarning: 'Aviso.' })).toMatchObject({
      id: '2', status: 'unknown', hasError: true, errorMessage: 'Falhou.', persistenceWarning: 'Aviso.',
    })
  })

  it('não cria um id artificial para payload sem turno', () => {
    expect(parseTurnCompletion({ threadId: 'thread-1' })).toEqual({
      id: null, status: 'unknown', hasError: false, errorMessage: null, persistenceWarning: null, persistedMessage: undefined,
    })
  })
})
