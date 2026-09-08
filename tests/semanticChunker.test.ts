import { describe, expect, it } from 'vitest'
import { chunkSemanticFile } from '../electron/semantic-index/SemanticChunker'

const sourceHash = 'a'.repeat(64)

describe('SemanticChunker', () => {
  it('cria chunks determinísticos por símbolo com hash do conteúdo', () => {
    const input = {
      file: {
        workspace: '/workspace',
        relativePath: 'src/app.ts',
        classification: 'source' as const,
        language: 'typescript',
        analyzedHash: sourceHash,
      },
      content: 'export function App() {\n  return true\n}\n',
      symbols: [{
        id: 'symbol-app',
        workspace: '/workspace',
        relativePath: 'src/app.ts',
        analyzedHash: sourceHash,
        kind: 'function' as const,
        name: 'App',
        qualifiedName: 'App',
        scope: null,
        signature: 'function App()',
        location: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 },
        exported: true,
        parserId: 'typescript',
        parserVersion: '5',
      }],
    }

    const first = chunkSemanticFile(input)
    const second = chunkSemanticFile(input)

    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ kind: 'symbol', symbolId: 'symbol-app', sourceHash, chunkStrategyVersion: 'symbols-v1' })
    expect(first[0].normalizedText).toContain('file: src/app.ts')
    expect(first[0].chunkHash).toHaveLength(64)
  })

  it('separa seções Markdown e preserva localização', () => {
    const chunks = chunkSemanticFile({
      file: {
        workspace: '/workspace',
        relativePath: 'README.md',
        classification: 'documentation',
        language: 'markdown',
        analyzedHash: sourceHash,
      },
      content: '# Intro\ntext\n\n## Usage\nrun it\n',
      symbols: [],
    })

    expect(chunks.map(({ symbolName, location }) => [symbolName, location.startLine])).toEqual([
      ['Intro', 1],
      ['Usage', 4],
    ])
  })

  it('usa fallback textual para arquivos sem símbolos', () => {
    const chunks = chunkSemanticFile({
      file: {
        workspace: '/workspace',
        relativePath: 'config.yaml',
        classification: 'configuration',
        language: 'yaml',
        analyzedHash: sourceHash,
      },
      content: 'name: nocturne\nmode: local\n',
      symbols: [],
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0].kind).toBe('configuration')
  })

  it('não produz unidades sem hash analisado', () => {
    expect(chunkSemanticFile({
      file: {
        workspace: '/workspace',
        relativePath: 'unknown.txt',
        classification: 'unknown',
        language: '',
        analyzedHash: null,
      },
      content: 'content',
      symbols: [],
    })).toEqual([])
  })
})
