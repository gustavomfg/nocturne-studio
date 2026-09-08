import { describe, expect, it } from 'vitest'
import { combineScores, cosineSimilarity, normalizeLexicalRank } from '../electron/semantic-index/SemanticRetrievalService'

describe('SemanticRetrievalService scoring', () => {
  it('normaliza ranking lexical semântico sem comparar bm25 com cosine diretamente', () => {
    expect(normalizeLexicalRank(-10, -10, -2)).toBe(1)
    expect(normalizeLexicalRank(-2, -10, -2)).toBe(0)
    expect(normalizeLexicalRank(-6, -10, -2)).toBe(0.5)
  })

  it('calcula cosine em espaço compatível e rejeita dimensões diferentes', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0.5)
    expect(cosineSimilarity([1, 0], [1])).toBe(0)
  })

  it('renormaliza pesos quando embeddings não estão disponíveis', () => {
    expect(combineScores({ vector: 0, lexical: 1, structural: 0, dependency: 0 }, false)).toBe(1)
    expect(combineScores({ vector: 1, lexical: 0, structural: 0, dependency: 0 }, true)).toBe(1)
    expect(combineScores({ vector: 0, lexical: 0, structural: 0, dependency: 0 }, false)).toBe(0)
  })
})
