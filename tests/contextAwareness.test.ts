import { describe, expect, it } from 'vitest'
import { retainSerializedAwarenessSelections } from '../electron/ai/ContextAwareness'
import type { AwarenessContextSelection } from '../shared/awareness'
import type { ContextSource } from '../shared/ai/task'

describe('proveniência de Awareness', () => {
  it('mantém apenas seleções cujo conteúdo foi serializado', () => {
    const sources: ContextSource[] = [{
      id: 'project-index:run-1', type: 'project-index', title: 'Índice', scope: 'workspace', potentiallyOutdated: false,
      content: 'Símbolo function kept · src/kept.ts:1',
    }, {
      id: 'semantic-index:unit-kept', type: 'semantic-index', title: 'Kept', scope: 'workspace', potentiallyOutdated: false,
      content: 'kept excerpt',
    }]
    const selection = (id: string, source: AwarenessContextSelection['source'], sourceId: string | null, contentPreview: string): AwarenessContextSelection => ({
      id, title: id, source, sourceType: source === 'workspace-memory' ? 'workspace' : source === 'brain-memory' ? 'manual' : source, sourceId, kind: 'project-symbol', scope: 'workspace', relevance: 50,
      reason: 'test', updatedAt: null, contentPreview,
    })

    const result = retainSerializedAwarenessSelections(sources, [
      { sourceId: 'project-index:run-1', selection: selection('kept-project', 'project-index', 'symbol-1', 'function kept · src/kept.ts:1') },
      { sourceId: 'project-index:run-1', selection: selection('dropped-project', 'project-index', 'symbol-2', 'function dropped · src/dropped.ts:1') },
      { sourceId: 'semantic-index:unit-kept', selection: selection('kept-semantic', 'semantic-index', 'unit-kept', 'kept excerpt') },
      { sourceId: 'semantic-index:unit-dropped', selection: selection('dropped-semantic', 'semantic-index', 'unit-dropped', 'dropped excerpt') },
    ])

    expect(result.map((item) => item.id)).toEqual(['kept-project', 'kept-semantic'])
  })

  it('reconhece conteúdo JSON escapado de memória sem confundir candidato descartado', () => {
    const sources: ContextSource[] = [{
      id: 'brain-memory', type: 'memory', title: 'Memórias', scope: 'workspace', potentiallyOutdated: true,
      content: `{"id":"memory-1","content":${JSON.stringify('regra "importante"')}}`,
    }]
    const selection: AwarenessContextSelection = {
      id: 'memory-1', title: 'regra', source: 'brain-memory', sourceType: 'manual', sourceId: 'memory-1',
      kind: 'fact', scope: 'workspace', relevance: 60, reason: 'test', updatedAt: null, contentPreview: 'regra "importante"',
    }

    expect(retainSerializedAwarenessSelections(sources, [{ sourceId: 'brain-memory', selection }])).toEqual([selection])
    expect(retainSerializedAwarenessSelections(sources, [{ sourceId: 'brain-memory', selection: { ...selection, id: 'memory-2', contentPreview: 'outra memória' } }])).toEqual([])
  })
})
