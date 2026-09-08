import { createHash } from 'node:crypto'
import type { ProjectIndexFile, ProjectSymbol } from '../../shared/codeIntelligence'
import { SEMANTIC_CHUNK_STRATEGY_VERSION, type SemanticUnitKind, type SemanticUnitLocation } from '../../shared/semanticIndex'

export const SEMANTIC_CHUNK_LIMITS = {
  maxCharacters: 24_000,
  maxUnitsPerFile: 2_000,
} as const

export interface SemanticChunkInput {
  file: Pick<ProjectIndexFile, 'workspace' | 'relativePath' | 'classification' | 'language' | 'analyzedHash'>
  content: string
  symbols: readonly ProjectSymbol[]
}

export interface SemanticChunk {
  id: string
  workspace: string
  relativePath: string
  kind: SemanticUnitKind
  language: string | null
  symbolId: string | null
  symbolName: string | null
  location: SemanticUnitLocation
  sourceHash: string
  chunkHash: string
  normalizedText: string
  chunkStrategyVersion: string
}

export function chunkSemanticFile(input: SemanticChunkInput): SemanticChunk[] {
  if (!input.file.analyzedHash) return []
  const chunks = input.symbols.length > 0
    ? input.symbols.flatMap((symbol) => chunkSymbol(input, symbol))
    : chunkNonSymbolFile(input)
  return chunks.slice(0, SEMANTIC_CHUNK_LIMITS.maxUnitsPerFile)
}

function chunkSymbol(input: SemanticChunkInput, symbol: ProjectSymbol): SemanticChunk[] {
  const start = offsetAt(input.content, symbol.location.startLine, symbol.location.startColumn)
  const end = offsetAt(input.content, symbol.location.endLine, symbol.location.endColumn)
  const content = input.content.slice(start, Math.max(start, end)) || symbol.signature || symbol.name
  if (content.length <= SEMANTIC_CHUNK_LIMITS.maxCharacters) {
    return [createChunk(input, 'symbol', symbol.name, symbol.id, symbol.location, content)]
  }
  return splitText(input, 'symbol', symbol.name, symbol.id, symbol.location, content)
}

function chunkNonSymbolFile(input: SemanticChunkInput): SemanticChunk[] {
  if (input.file.classification === 'documentation') {
    const sections = markdownSections(input.content)
    if (sections.length > 0) {
      return sections.flatMap(({ title, start, end, location }) => {
        const section = input.content.slice(start, end)
        return section.length <= SEMANTIC_CHUNK_LIMITS.maxCharacters
          ? [createChunk(input, 'markdown-section', title, null, location, section)]
          : splitText(input, 'markdown-section', title, null, location, section)
      })
    }
  }
  const kind: SemanticUnitKind = input.file.classification === 'configuration' ? 'configuration' : 'text'
  if (input.content.length <= SEMANTIC_CHUNK_LIMITS.maxCharacters) {
    return [createChunk(input, kind, null, null, locationForRange(input.content, 0, input.content.length), input.content)]
  }
  return splitText(input, kind, null, null, locationForRange(input.content, 0, input.content.length), input.content)
}

function splitText(
  input: SemanticChunkInput,
  kind: SemanticUnitKind,
  symbolName: string | null,
  symbolId: string | null,
  parentLocation: SemanticUnitLocation,
  content: string,
): SemanticChunk[] {
  const chunks: SemanticChunk[] = []
  for (let offset = 0, ordinal = 0; offset < content.length; ordinal += 1) {
    const end = Math.min(content.length, offset + SEMANTIC_CHUNK_LIMITS.maxCharacters)
    const slice = content.slice(offset, end)
    const location = locationForRange(slice, 0, slice.length)
    chunks.push(createChunk(
      input,
      kind,
      symbolName ? `${symbolName}#${ordinal + 1}` : null,
      symbolId ? `${symbolId}:${ordinal + 1}` : null,
      mergeLocations(parentLocation, location),
      slice,
    ))
    offset = end
  }
  return chunks
}

function createChunk(
  input: SemanticChunkInput,
  kind: SemanticUnitKind,
  symbolName: string | null,
  symbolId: string | null,
  location: SemanticUnitLocation,
  content: string,
): SemanticChunk {
  const sourceHash = input.file.analyzedHash
  if (!sourceHash) throw new Error('Não é possível criar chunk sem hash analisado.')
  const normalizedText = normalizeText(input.file.relativePath, kind, symbolName, content)
  const chunkHash = hash(normalizedText)
  const id = `semantic:${hash([
    input.file.workspace,
    input.file.relativePath,
    kind,
    symbolId ?? symbolName ?? 'file',
    location.startLine,
    location.startColumn,
    location.endLine,
    location.endColumn,
  ].join('\0'))}`
  return {
    id,
    workspace: input.file.workspace,
    relativePath: input.file.relativePath,
    kind,
    language: input.file.language || null,
    symbolId,
    symbolName,
    location,
    sourceHash,
    chunkHash,
    normalizedText,
    chunkStrategyVersion: SEMANTIC_CHUNK_STRATEGY_VERSION,
  }
}

function normalizeText(relativePath: string, kind: SemanticUnitKind, symbolName: string | null, content: string) {
  const header = [`file: ${relativePath}`, `kind: ${kind}`, symbolName ? `symbol: ${symbolName}` : null]
    .filter((value): value is string => Boolean(value))
    .join('\n')
  return `${header}\n\n${content.replace(/\r\n?/g, '\n').trim()}`.trim()
}

function markdownSections(content: string) {
  const headings = [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)]
  return headings.map((heading, index) => {
    const start = heading.index ?? 0
    const end = headings[index + 1]?.index ?? content.length
    return {
      title: heading[2].trim(),
      start,
      end,
      location: locationForRange(content, start, end),
    }
  })
}

function locationForRange(content: string, start: number, end: number): SemanticUnitLocation {
  const startPosition = positionAt(content, start)
  const endPosition = positionAt(content, Math.max(start, end))
  return {
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
    startOffset: start,
    endOffset: Math.max(start, end),
  }
}

function mergeLocations(parent: SemanticUnitLocation, child: SemanticUnitLocation): SemanticUnitLocation {
  return {
    startLine: parent.startLine + child.startLine - 1,
    startColumn: child.startLine === 1 ? parent.startColumn + child.startColumn - 1 : child.startColumn,
    endLine: parent.startLine + child.endLine - 1,
    endColumn: child.endLine === 1 ? parent.startColumn + child.endColumn - 1 : child.endColumn,
    startOffset: (parent.startOffset ?? 0) + (child.startOffset ?? 0),
    endOffset: (parent.startOffset ?? 0) + (child.endOffset ?? 0),
  }
}

function offsetAt(content: string, line: number, column: number) {
  const lines = content.split('\n')
  let offset = 0
  for (let index = 1; index < line && index <= lines.length; index += 1) offset += lines[index - 1].length + 1
  return Math.min(content.length, offset + Math.max(0, column - 1))
}

function positionAt(content: string, offset: number) {
  const prefix = content.slice(0, Math.max(0, Math.min(content.length, offset)))
  const lines = prefix.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
