import { describe, expect, it } from 'vitest'
import { semanticEmbeddingBindingSchema, semanticSearchQuerySchema, semanticUnitSchema } from '../shared/semanticIndexSchemas'

const now = '2026-09-08T12:00:00.000Z'

describe('semantic index contracts', () => {
  it('aceita unidade lexical sem vetor, preservando hash e proveniência', () => {
    const unit = semanticUnitSchema.parse({
      id: 'unit:src/app.ts:1',
      workspace: '/workspace',
      relativePath: 'src/app.ts',
      kind: 'symbol',
      language: 'typescript',
      symbolId: 'symbol-1',
      symbolName: 'App',
      location: { startLine: 1, startColumn: 1, endLine: 4, endColumn: 2 },
      sourceHash: 'a'.repeat(64),
      chunkHash: 'b'.repeat(64),
      normalizedText: 'export function App() {}',
      chunkStrategyVersion: 'symbols-v1',
      embeddingSpace: null,
      status: 'lexical-only',
      error: null,
      createdAt: now,
      updatedAt: now,
      indexedAt: null,
    })

    expect(unit.embeddingSpace).toBeNull()
    expect(unit.sourceHash).toHaveLength(64)
  })

  it('rejeita unidade com hash ou intervalo inválido', () => {
    expect(() => semanticUnitSchema.parse({
      id: 'unit',
      workspace: '/workspace',
      relativePath: 'src/app.ts',
      kind: 'symbol',
      language: 'typescript',
      symbolId: null,
      symbolName: null,
      location: { startLine: 0, startColumn: 1, endLine: 1, endColumn: 1 },
      sourceHash: 'not-a-hash',
      chunkHash: 'b'.repeat(64),
      normalizedText: 'code',
      chunkStrategyVersion: 'symbols-v1',
      embeddingSpace: null,
      status: 'pending',
      error: null,
      createdAt: now,
      updatedAt: now,
      indexedAt: null,
    })).toThrow()
  })

  it('mantém binding de embedding explícito e independente', () => {
    expect(semanticEmbeddingBindingSchema.parse({
      reference: { providerId: 'local', modelId: 'embed-code' },
      remoteAllowed: false,
    })).toEqual({
      reference: { providerId: 'local', modelId: 'embed-code' },
      remoteAllowed: false,
    })
  })

  it('limita consultas semânticas ao workspace e aos filtros conhecidos', () => {
    expect(semanticSearchQuerySchema.parse({
      workspace: '/workspace',
      query: 'autorização do workspace',
      limit: 10,
      filters: { languages: ['typescript'], kinds: ['symbol'] },
    })).toMatchObject({ workspace: '/workspace', limit: 10 })
  })
})
