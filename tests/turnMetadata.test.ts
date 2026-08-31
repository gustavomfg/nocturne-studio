import { describe, expect, it } from 'vitest'
import { parseConversationTurnMetadata } from '../src/domains/chat/turnMetadata'

describe('metadados de turno da conversa', () => {
  it('aceita somente campos de restauração conhecidos', () => {
    expect(parseConversationTurnMetadata(JSON.stringify({
      diff: '+linha',
      activities: [{ id: 'activity-1' }],
      files: [{ path: 'src/App.tsx' }],
      plan: [{ step: 'validar' }],
      planExplanation: 'explicação',
      privateValue: 'ignorado',
    }))).toMatchObject({ diff: '+linha', planExplanation: 'explicação' })
  })

  it('ignora metadata ausente ou inválido sem interromper a abertura da conversa', () => {
    expect(parseConversationTurnMetadata('não é JSON')).toBeNull()
    expect(parseConversationTurnMetadata(JSON.stringify(null))).toBeNull()
  })
})
