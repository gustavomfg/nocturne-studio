import { describe, expect, it } from 'vitest'
import { isSupportedLanguage, translate } from '../src/shared/i18n'

describe('interface languages', () => {
  it('supports Portuguese (Brazil) and English with Portuguese as the default fallback', () => {
    expect(isSupportedLanguage('pt-BR')).toBe(true)
    expect(isSupportedLanguage('en')).toBe(true)
    expect(isSupportedLanguage('fr')).toBe(false)
    expect(translate('pt-BR', 'nav.newConversation')).toBe('Nova conversa')
    expect(translate('en', 'nav.newConversation')).toBe('New conversation')
  })

  it('interpolates bounded values in both languages', () => {
    expect(translate('pt-BR', 'common.filesObserved', { count: 3 })).toBe('3 arquivo(s) observado(s)')
    expect(translate('en', 'common.filesObserved', { count: 3 })).toBe('3 file(s) observed')
  })
})
