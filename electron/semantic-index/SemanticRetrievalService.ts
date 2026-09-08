import { SEMANTIC_INDEX_VERSION } from '../../shared/semanticIndex'
import type { SemanticSearchQuery, SemanticSearchResult, SemanticUnit } from '../../shared/semanticIndex'
import type { ProjectIndexService } from '../project-index/ProjectIndexService'
import type { SemanticEmbeddingOperations } from './SemanticIndexService'
import { SemanticIndexRepository, type SemanticLexicalMatch, type StoredSemanticEmbedding } from '../database/SemanticIndexRepository'

const RETRIEVAL_LIMITS = {
  lexicalCandidates: 100,
  vectorCandidates: 200,
  structuralCandidates: 500,
  dependencyPaths: 24,
  dependencyDepth: 1,
} as const

interface Candidate {
  unit: SemanticUnit
  vector: number
  lexical: number
  structural: number
  dependency: number
}

/** Combines independent retrieval signals without comparing their raw scales. */
export class SemanticRetrievalService {
  constructor(
    private readonly repository: SemanticIndexRepository,
    private readonly projectIndex: ProjectIndexService,
    private readonly embeddings?: SemanticEmbeddingOperations,
  ) {}

  async search(input: SemanticSearchQuery): Promise<SemanticSearchResult[]> {
    const workspace = input.workspace
    const filters = input.filters ?? {}
    const lexical = this.repository.searchLexical(workspace, input.query, filters, RETRIEVAL_LIMITS.lexicalCandidates)
    const embedding = await this.resolveQueryEmbedding(workspace, input.query)
    const vectors = embedding ? this.repository.listIndexedEmbeddings(workspace, embedding.space) : []
    const vectorScores = embedding ? rankVectors(vectors, embedding.vector) : new Map<string, number>()
    const lexicalScores = rankLexical(lexical)
    const dependencyPaths = this.dependencyExpansion(workspace, lexical)
    const structuralCandidates = this.repository.listUnits(workspace, filters, RETRIEVAL_LIMITS.structuralCandidates)
    const candidates = new Map<string, Candidate>()

    for (const unit of structuralCandidates) {
      if (!this.isCurrent(workspace, unit)) continue
      candidates.set(unit.id, {
        unit,
        vector: vectorScores.get(unit.id) ?? 0,
        lexical: lexicalScores.get(unit.id) ?? 0,
        structural: structuralRelevance(unit, input.query),
        dependency: dependencyPaths.has(unit.relativePath) ? 1 : 0,
      })
    }
    for (const match of lexical) this.addCandidate(candidates, match.unit, input.query, lexicalScores.get(match.unit.id) ?? 0, dependencyPaths)
    for (const stored of vectors.slice(0, RETRIEVAL_LIMITS.vectorCandidates)) {
      if (!this.isCurrent(workspace, stored.unit)) continue
      const current = candidates.get(stored.unit.id)
      if (current) {
        current.vector = vectorScores.get(stored.unit.id) ?? 0
      } else {
        this.addCandidate(candidates, stored.unit, input.query, lexicalScores.get(stored.unit.id) ?? 0, dependencyPaths)
        candidates.get(stored.unit.id)!.vector = vectorScores.get(stored.unit.id) ?? 0
      }
    }

    const hasVector = vectorScores.size > 0
    return [...candidates.values()]
      .map((candidate) => {
        const final = combineScores(candidate, hasVector)
        const reasons = []
        if (candidate.vector > 0) reasons.push('similaridade vetorial')
        if (candidate.lexical > 0) reasons.push('correspondência lexical')
        if (candidate.structural > 0) reasons.push('símbolo ou caminho relevante')
        if (candidate.dependency > 0) reasons.push('relação de importação próxima')
        return {
          unit: {
            id: candidate.unit.id,
            relativePath: candidate.unit.relativePath,
            kind: candidate.unit.kind,
            language: candidate.unit.language,
            symbolId: candidate.unit.symbolId,
            symbolName: candidate.unit.symbolName,
            location: candidate.unit.location,
            sourceHash: candidate.unit.sourceHash,
            chunkHash: candidate.unit.chunkHash,
            status: candidate.unit.status,
          },
          excerpt: candidate.unit.normalizedText.slice(0, 2_000),
          scores: {
            vector: candidate.vector,
            lexical: candidate.lexical,
            structural: candidate.structural,
            dependency: candidate.dependency,
            final,
          },
          provenance: {
            indexVersion: SEMANTIC_INDEX_VERSION,
            chunkStrategyVersion: candidate.unit.chunkStrategyVersion,
            embeddingSpace: candidate.unit.embeddingSpace,
            reason: reasons.length ? reasons.join(', ') : 'unidade estrutural elegível',
            potentiallyOutdated: false,
          },
        }
      })
      .filter((result) => result.scores.final > 0)
      .sort((left, right) => right.scores.final - left.scores.final || left.unit.relativePath.localeCompare(right.unit.relativePath))
      .slice(0, Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20))))
  }

  private addCandidate(candidates: Map<string, Candidate>, unit: SemanticUnit, query: string, lexical: number, dependencyPaths: ReadonlySet<string>) {
    if (candidates.has(unit.id)) return
    candidates.set(unit.id, {
      unit,
      vector: 0,
      lexical,
      structural: structuralRelevance(unit, query),
      dependency: dependencyPaths.has(unit.relativePath) ? 1 : 0,
    })
  }

  private isCurrent(workspace: string, unit: SemanticUnit) {
    const file = this.projectIndex.getFile(workspace, unit.relativePath)
    return Boolean(file && file.analyzedHash === unit.sourceHash && ['indexed', 'unsupported'].includes(file.state) && ['indexed', 'lexical-only'].includes(unit.status))
  }

  private dependencyExpansion(workspace: string, matches: readonly SemanticLexicalMatch[]) {
    const paths = new Set<string>()
    for (const match of matches.slice(0, RETRIEVAL_LIMITS.dependencyPaths)) {
      const imports = this.projectIndex.listImports(workspace, match.unit.relativePath)
      for (const relation of imports) {
        if (relation.resolution === 'local' && relation.targetPath) paths.add(relation.targetPath)
        if (paths.size >= RETRIEVAL_LIMITS.dependencyPaths) return paths
      }
    }
    return paths
  }

  private async resolveQueryEmbedding(workspace: string, query: string) {
    if (!this.embeddings) return null
    const resolved = await this.embeddings.resolve(workspace).catch(() => null)
    if (!resolved || (resolved.remote && !resolved.remoteAllowed)) return null
    const result = await this.embeddings.embed(workspace, resolved.space, [query], new AbortController().signal).catch(() => null)
    const vector = result?.[0]
    const dimensions = resolved.space.dimensions > 0 ? resolved.space.dimensions : vector?.length ?? 0
    if (!vector || dimensions < 1 || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) return null
    return { space: { ...resolved.space, dimensions }, vector }
  }
}

export function normalizeLexicalRank(rank: number, bestRank: number, worstRank: number) {
  if (!Number.isFinite(rank) || !Number.isFinite(bestRank) || !Number.isFinite(worstRank)) return 0
  if (bestRank === worstRank) return 1
  return clamp((worstRank - rank) / (worstRank - bestRank))
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return clamp((dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)) + 1) / 2)
}

export function combineScores(candidate: Pick<Candidate, 'vector' | 'lexical' | 'structural' | 'dependency'>, hasVector: boolean) {
  const weights = hasVector
    ? { vector: 0.55, lexical: 0.25, structural: 0.15, dependency: 0.05 }
    : { vector: 0, lexical: 0.55, structural: 0.35, dependency: 0.1 }
  const activeWeight = (candidate.vector > 0 ? weights.vector : 0)
    + (candidate.lexical > 0 ? weights.lexical : 0)
    + (candidate.structural > 0 ? weights.structural : 0)
    + (candidate.dependency > 0 ? weights.dependency : 0)
  if (activeWeight === 0) return 0
  const weighted = candidate.vector * weights.vector
    + candidate.lexical * weights.lexical
    + candidate.structural * weights.structural
    + candidate.dependency * weights.dependency
  return clamp(weighted / activeWeight)
}

function rankLexical(matches: readonly SemanticLexicalMatch[]) {
  if (!matches.length) return new Map<string, number>()
  const ranks = matches.map(({ rank }) => rank)
  const best = Math.min(...ranks)
  const worst = Math.max(...ranks)
  return new Map(matches.map(({ unit, rank }) => [unit.id, normalizeLexicalRank(rank, best, worst)]))
}

function rankVectors(vectors: readonly StoredSemanticEmbedding[], query: readonly number[]) {
  return new Map(vectors.map(({ unit, embedding }) => [unit.id, cosineSimilarity(query, embedding)]))
}

function structuralRelevance(unit: SemanticUnit, query: string) {
  const terms = new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}_$]+/u).filter((term) => term.length >= 2))
  if (!terms.size) return 0
  const haystack = `${unit.relativePath} ${unit.symbolName ?? ''} ${unit.kind} ${unit.language ?? ''}`.toLocaleLowerCase()
  const matches = [...terms].filter((term) => haystack.includes(term)).length
  return clamp(matches / terms.size)
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}
