import type { AwarenessContextSelection } from '../../shared/awareness'
import type { ContextSource } from '../../shared/ai/task'

export interface AwarenessCandidate {
  selection: AwarenessContextSelection
  sourceId: string
}

/** Keeps Awareness aligned with the bytes that survived context assembly. */
export function retainSerializedAwarenessSelections(
  sources: readonly ContextSource[],
  candidates: readonly AwarenessCandidate[],
) {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  return candidates
    .filter(({ selection, sourceId }) => {
      const source = sourceById.get(sourceId)
      if (!source) return false
      const preview = selection.contentPreview.trim()
      if (!preview) return true
      // Context assembly may truncate a source. A bounded prefix still proves
      // that the selected item contributed bytes; otherwise the item is not
      // provenance for the final serialized context.
      const prefix = preview.replace(/…$/, '').slice(0, 160)
      const variants = [preview, prefix]
      if (source.type === 'memory') {
        variants.push(jsonStringContent(preview), jsonStringContent(prefix))
      }
      return variants.some((variant) => Boolean(variant) && source.content.includes(variant))
    })
    .map(({ selection }) => selection)
}

function jsonStringContent(value: string) {
  const encoded = JSON.stringify(value)
  return encoded ? encoded.slice(1, -1) : ''
}
