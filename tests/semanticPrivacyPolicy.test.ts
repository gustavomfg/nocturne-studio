import { describe, expect, it } from 'vitest'
import { SemanticPrivacyPolicy } from '../electron/semantic-index/SemanticPrivacyPolicy'

const base = {
  relativePath: 'src/app.ts',
  classification: 'source' as const,
  excluded: false,
  exclusionReason: null,
}

describe('SemanticPrivacyPolicy', () => {
  it('bloqueia segredos antes da leitura e do adapter', () => {
    expect(new SemanticPrivacyPolicy().evaluate({ ...base, relativePath: '.env.local' }, true)).toEqual({
      allowed: false,
      embeddingAllowed: false,
      reason: expect.stringContaining('sensível'),
    })
    expect(new SemanticPrivacyPolicy().evaluate({ ...base, relativePath: 'certs/server.pem' }, true).allowed).toBe(false)
  })

  it('reutiliza exclusões do Project Index', () => {
    expect(new SemanticPrivacyPolicy().evaluate({ ...base, relativePath: 'node_modules/pkg/index.js' }, true).allowed).toBe(false)
    expect(new SemanticPrivacyPolicy().evaluate({ ...base, excluded: true, exclusionReason: 'configurado pelo usuário' }, true).reason).toBe('configurado pelo usuário')
  })

  it('permite indexação lexical local sem autorizar embedding remoto', () => {
    expect(new SemanticPrivacyPolicy().evaluate(base, false)).toEqual({
      allowed: true,
      embeddingAllowed: false,
      reason: 'Embedding remoto não autorizado para este workspace.',
    })
  })
})
