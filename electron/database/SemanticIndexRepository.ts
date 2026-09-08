import type Database from 'better-sqlite3'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'
import {
  SEMANTIC_INDEX_VERSION,
  type SemanticEmbeddingSpace,
  type SemanticIndexRun,
  type SemanticIndexSummary,
  type SemanticSearchFilters,
  type SemanticUnit,
} from '../../shared/semanticIndex'

export type PersistedSemanticUnit = SemanticUnit & {
  embedding?: readonly number[]
}

interface SemanticUnitRow {
  id: string
  workspace: string
  relativePath: string
  kind: SemanticUnit['kind']
  language: string | null
  symbolId: string | null
  symbolName: string | null
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  startOffset: number | null
  endOffset: number | null
  sourceHash: string
  chunkHash: string
  normalizedText: string
  chunkStrategyVersion: string
  embeddingProviderId: string | null
  embeddingModelId: string | null
  embeddingModelVersion: string | null
  embeddingDimensions: number | null
  embedding: Buffer | null
  status: SemanticUnit['status']
  error: string | null
  createdAt: string
  updatedAt: string
  indexedAt: string | null
}

export interface SemanticLexicalMatch {
  unit: SemanticUnit
  rank: number
}

export interface StoredSemanticEmbedding {
  unit: SemanticUnit
  embedding: readonly number[]
}

/** Persists semantic units as rebuildable, workspace-scoped derived data. */
export class SemanticIndexRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  createRun(run: SemanticIndexRun) {
    this.database.prepare(`INSERT INTO semantic_index_runs(
      id,workspace,index_version,kind,status,total_files,processed_files,indexed_units,
      lexical_only_units,failed_files,excluded_files,started_at,completed_at,updated_at,error
    ) VALUES(@id,@workspace,@indexVersion,@kind,@status,@totalFiles,@processedFiles,@indexedUnits,
      @lexicalOnlyUnits,@failedFiles,@excludedFiles,@startedAt,@completedAt,@updatedAt,@error)`).run({
      id: run.id,
      workspace: run.workspace,
      indexVersion: SEMANTIC_INDEX_VERSION,
      kind: run.kind,
      status: run.status,
      totalFiles: run.totalFiles,
      processedFiles: run.processedFiles,
      indexedUnits: run.indexedUnits,
      lexicalOnlyUnits: run.lexicalOnlyUnits,
      failedFiles: run.failedFiles,
      excludedFiles: run.excludedFiles,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
      error: run.error,
    })
  }

  updateRun(run: SemanticIndexRun) {
    this.database.prepare(`UPDATE semantic_index_runs SET
      status=@status,total_files=@totalFiles,processed_files=@processedFiles,indexed_units=@indexedUnits,
      lexical_only_units=@lexicalOnlyUnits,failed_files=@failedFiles,excluded_files=@excludedFiles,
      completed_at=@completedAt,updated_at=@updatedAt,error=@error
      WHERE id=@id AND workspace=@workspace`).run({
      id: run.id,
      workspace: run.workspace,
      status: run.status,
      totalFiles: run.totalFiles,
      processedFiles: run.processedFiles,
      indexedUnits: run.indexedUnits,
      lexicalOnlyUnits: run.lexicalOnlyUnits,
      failedFiles: run.failedFiles,
      excludedFiles: run.excludedFiles,
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
      error: run.error,
    })
  }

  latestRun(workspace: string): SemanticIndexRun | null {
    const row = this.database.prepare(`${semanticRunSelect}
      WHERE workspace=? ORDER BY updated_at DESC LIMIT 1`).get(workspace) as SemanticIndexRun | undefined
    return row ?? null
  }

  getUnit(workspace: string, id: string): SemanticUnit | null {
    const row = this.database.prepare(`${semanticUnitSelect}
      WHERE workspace=? AND id=?`).get(workspace, id) as SemanticUnitRow | undefined
    return row ? toSemanticUnit(row) : null
  }

  listUnits(workspace: string, filters: SemanticSearchFilters = {}, limit = 50_000): SemanticUnit[] {
    const clauses = ['workspace=?']
    const parameters: unknown[] = [workspace]
    appendFilters(clauses, parameters, filters)
    const rows = this.database.prepare(`${semanticUnitSelect}
      WHERE ${clauses.join(' AND ')} ORDER BY relative_path,start_line,id LIMIT ?`).all(...parameters, boundedLimit(limit, 50_000)) as SemanticUnitRow[]
    return rows.map(toSemanticUnit)
  }

  listFileUnits(workspace: string, relativePath: string): SemanticUnit[] {
    const rows = this.database.prepare(`${semanticUnitSelect}
      WHERE workspace=? AND relative_path=? ORDER BY start_line,start_column,id`).all(workspace, relativePath) as SemanticUnitRow[]
    return rows.map(toSemanticUnit)
  }

  listIndexedEmbeddings(workspace: string, space: SemanticEmbeddingSpace): StoredSemanticEmbedding[] {
    const dimensionsClause = space.dimensions > 0 ? 'AND embedding_dimensions=?' : ''
    const parameters: unknown[] = [workspace, space.providerId, space.modelId, space.modelVersion]
    if (space.dimensions > 0) parameters.push(space.dimensions)
    const rows = this.database.prepare(`${semanticUnitSelect}
      WHERE workspace=? AND status='indexed'
        AND embedding_provider_id=? AND embedding_model_id=?
        AND embedding_model_version IS ? ${dimensionsClause}
        AND embedding IS NOT NULL`).all(
      ...parameters,
    ) as SemanticUnitRow[]
    return rows.flatMap((row) => {
      if (!row.embedding) return []
      return [{ unit: toSemanticUnit(row), embedding: deserializeEmbedding(row.embedding, row.embeddingDimensions) }]
    })
  }

  searchLexical(workspace: string, query: string, filters: SemanticSearchFilters = {}, limit = 50): SemanticLexicalMatch[] {
    const ftsQuery = toFtsQuery(query)
    if (!ftsQuery) return []
    const clauses = ['unit.workspace=?', 'semantic_units_fts MATCH ?', "unit.status IN ('indexed','lexical-only')"]
    const parameters: unknown[] = [workspace, ftsQuery]
    appendFilters(clauses, parameters, filters, 'unit.')
    const rows = this.database.prepare(`SELECT
      unit.id,unit.workspace,unit.relative_path relativePath,unit.kind,unit.language,
      unit.symbol_id symbolId,unit.symbol_name symbolName,unit.start_line startLine,
      unit.start_column startColumn,unit.end_line endLine,unit.end_column endColumn,
      unit.start_offset startOffset,unit.end_offset endOffset,unit.source_hash sourceHash,
      unit.chunk_hash chunkHash,unit.normalized_text normalizedText,
      unit.chunk_strategy_version chunkStrategyVersion,unit.embedding_provider_id embeddingProviderId,
      unit.embedding_model_id embeddingModelId,unit.embedding_model_version embeddingModelVersion,
      unit.embedding_dimensions embeddingDimensions,unit.embedding,unit.status,unit.error,
      unit.created_at createdAt,unit.updated_at updatedAt,unit.indexed_at indexedAt,
      bm25(semantic_units_fts) rank
      FROM semantic_units_fts
      JOIN semantic_units unit ON unit.rowid=semantic_units_fts.rowid
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank LIMIT ?`).all(...parameters, boundedLimit(limit, 100)) as Array<SemanticUnitRow & { rank: number }>
    return rows.map(({ rank, ...row }) => ({ unit: toSemanticUnit(row), rank }))
  }

  replaceFileUnits(workspace: string, relativePath: string, units: readonly PersistedSemanticUnit[]) {
    this.transactions.run('semanticIndex.replaceFileUnits', () => {
      const ids = units.map(({ id }) => id)
      if (ids.length === 0) {
        this.database.prepare('DELETE FROM semantic_units WHERE workspace=? AND relative_path=?').run(workspace, relativePath)
        return
      }
      const placeholders = ids.map(() => '?').join(',')
      this.database.prepare(`DELETE FROM semantic_units
        WHERE workspace=? AND relative_path=? AND id NOT IN (${placeholders})`).run(workspace, relativePath, ...ids)
      const statement = this.database.prepare(`INSERT INTO semantic_units(
        id,workspace,relative_path,kind,language,symbol_id,symbol_name,start_line,start_column,end_line,end_column,
        start_offset,end_offset,source_hash,chunk_hash,normalized_text,chunk_strategy_version,
        embedding_provider_id,embedding_model_id,embedding_model_version,embedding_dimensions,embedding,
        status,error,created_at,updated_at,indexed_at
      ) VALUES(@id,@workspace,@relativePath,@kind,@language,@symbolId,@symbolName,@startLine,@startColumn,@endLine,@endColumn,
        @startOffset,@endOffset,@sourceHash,@chunkHash,@normalizedText,@chunkStrategyVersion,
        @embeddingProviderId,@embeddingModelId,@embeddingModelVersion,@embeddingDimensions,@embedding,
        @status,@error,@createdAt,@updatedAt,@indexedAt)
      ON CONFLICT(id) DO UPDATE SET
        workspace=excluded.workspace,relative_path=excluded.relative_path,kind=excluded.kind,language=excluded.language,
        symbol_id=excluded.symbol_id,symbol_name=excluded.symbol_name,start_line=excluded.start_line,start_column=excluded.start_column,
        end_line=excluded.end_line,end_column=excluded.end_column,start_offset=excluded.start_offset,end_offset=excluded.end_offset,
        source_hash=excluded.source_hash,chunk_hash=excluded.chunk_hash,normalized_text=excluded.normalized_text,
        chunk_strategy_version=excluded.chunk_strategy_version,embedding_provider_id=excluded.embedding_provider_id,
        embedding_model_id=excluded.embedding_model_id,embedding_model_version=excluded.embedding_model_version,
        embedding_dimensions=excluded.embedding_dimensions,embedding=excluded.embedding,status=excluded.status,error=excluded.error,
        updated_at=excluded.updated_at,indexed_at=excluded.indexed_at`)
      for (const unit of units) statement.run(unitParameters(unit))
    })
  }

  markFileStale(workspace: string, relativePath: string, reason = 'O arquivo mudou após a análise.') {
    this.transactions.run('semanticIndex.markFileStale', () => {
      this.database.prepare(`UPDATE semantic_units SET status='stale',error=?,updated_at=?
        WHERE workspace=? AND relative_path=?`).run(reason, new Date().toISOString(), workspace, relativePath)
    })
  }

  deleteFile(workspace: string, relativePath: string) {
    this.transactions.run('semanticIndex.deleteFile', () => {
      this.database.prepare('DELETE FROM semantic_units WHERE workspace=? AND relative_path=?').run(workspace, relativePath)
    })
  }

  summary(workspace: string): SemanticIndexSummary {
    const counts = this.database.prepare(`SELECT COUNT(*) units,
      COUNT(DISTINCT relative_path) files,
      SUM(CASE WHEN status='indexed' THEN 1 ELSE 0 END) indexedUnits,
      SUM(CASE WHEN status='lexical-only' THEN 1 ELSE 0 END) lexicalOnlyUnits,
      SUM(CASE WHEN status='stale' THEN 1 ELSE 0 END) staleUnits,
      SUM(CASE WHEN status IN ('failed','incompatible') THEN 1 ELSE 0 END) failedUnits,
      SUM(CASE WHEN status='excluded' THEN 1 ELSE 0 END) excludedUnits
      FROM semantic_units WHERE workspace=?`).get(workspace) as {
        units: number | null
        files: number | null
        indexedUnits: number | null
        lexicalOnlyUnits: number | null
        staleUnits: number | null
        failedUnits: number | null
        excludedUnits: number | null
      }
    return {
      workspace,
      indexVersion: SEMANTIC_INDEX_VERSION,
      latestRun: this.latestRun(workspace),
      files: counts.files ?? 0,
      units: counts.units ?? 0,
      indexedUnits: counts.indexedUnits ?? 0,
      lexicalOnlyUnits: counts.lexicalOnlyUnits ?? 0,
      staleUnits: counts.staleUnits ?? 0,
      failedUnits: counts.failedUnits ?? 0,
      excludedUnits: counts.excludedUnits ?? 0,
    }
  }
}

const semanticRunSelect = `SELECT id,workspace,index_version indexVersion,kind,status,
  total_files totalFiles,processed_files processedFiles,indexed_units indexedUnits,
  lexical_only_units lexicalOnlyUnits,failed_files failedFiles,excluded_files excludedFiles,
  started_at startedAt,completed_at completedAt,updated_at updatedAt,error
  FROM semantic_index_runs`

const semanticUnitSelect = `SELECT id,workspace,relative_path relativePath,kind,language,
  symbol_id symbolId,symbol_name symbolName,start_line startLine,start_column startColumn,
  end_line endLine,end_column endColumn,start_offset startOffset,end_offset endOffset,
  source_hash sourceHash,chunk_hash chunkHash,normalized_text normalizedText,
  chunk_strategy_version chunkStrategyVersion,embedding_provider_id embeddingProviderId,
  embedding_model_id embeddingModelId,embedding_model_version embeddingModelVersion,
  embedding_dimensions embeddingDimensions,embedding,status,error,created_at createdAt,
  updated_at updatedAt,indexed_at indexedAt FROM semantic_units`

function unitParameters(unit: PersistedSemanticUnit) {
  return {
    id: unit.id,
    workspace: unit.workspace,
    relativePath: unit.relativePath,
    kind: unit.kind,
    language: unit.language,
    symbolId: unit.symbolId,
    symbolName: unit.symbolName,
    startLine: unit.location.startLine,
    startColumn: unit.location.startColumn,
    endLine: unit.location.endLine,
    endColumn: unit.location.endColumn,
    startOffset: unit.location.startOffset ?? null,
    endOffset: unit.location.endOffset ?? null,
    sourceHash: unit.sourceHash,
    chunkHash: unit.chunkHash,
    normalizedText: unit.normalizedText,
    chunkStrategyVersion: unit.chunkStrategyVersion,
    embeddingProviderId: unit.embeddingSpace?.providerId ?? null,
    embeddingModelId: unit.embeddingSpace?.modelId ?? null,
    embeddingModelVersion: unit.embeddingSpace?.modelVersion ?? null,
    embeddingDimensions: unit.embeddingSpace?.dimensions ?? null,
    embedding: unit.embedding ? serializeEmbedding(unit.embedding) : null,
    status: unit.status,
    error: unit.error,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
    indexedAt: unit.indexedAt,
  }
}

function toSemanticUnit(row: SemanticUnitRow): SemanticUnit {
  return {
    id: row.id,
    workspace: row.workspace,
    relativePath: row.relativePath,
    kind: row.kind,
    language: row.language,
    symbolId: row.symbolId,
    symbolName: row.symbolName,
    location: {
      startLine: row.startLine,
      startColumn: row.startColumn,
      endLine: row.endLine,
      endColumn: row.endColumn,
      ...(row.startOffset === null ? {} : { startOffset: row.startOffset }),
      ...(row.endOffset === null ? {} : { endOffset: row.endOffset }),
    },
    sourceHash: row.sourceHash,
    chunkHash: row.chunkHash,
    normalizedText: row.normalizedText,
    chunkStrategyVersion: row.chunkStrategyVersion,
    embeddingSpace: row.embeddingProviderId && row.embeddingModelId && row.embeddingDimensions
      ? {
        providerId: row.embeddingProviderId,
        modelId: row.embeddingModelId,
        modelVersion: row.embeddingModelVersion,
        dimensions: row.embeddingDimensions,
      }
      : null,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    indexedAt: row.indexedAt,
  }
}

function appendFilters(clauses: string[], parameters: unknown[], filters: SemanticSearchFilters, prefix = '') {
  if (filters.paths?.length) {
    clauses.push(`(${filters.paths.map(() => `${prefix}relative_path=?`).join(' OR ')})`)
    parameters.push(...filters.paths)
  }
  if (filters.languages?.length) {
    clauses.push(`(${filters.languages.map(() => `${prefix}language=?`).join(' OR ')})`)
    parameters.push(...filters.languages)
  }
  if (filters.kinds?.length) {
    clauses.push(`(${filters.kinds.map(() => `${prefix}kind=?`).join(' OR ')})`)
    parameters.push(...filters.kinds)
  }
  if (filters.symbols?.length) {
    clauses.push(`(${filters.symbols.map(() => `${prefix}symbol_name=?`).join(' OR ')})`)
    parameters.push(...filters.symbols)
  }
}

function toFtsQuery(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).map((token) => `"${token.replace(/"/g, '""')}"`).join(' AND ')
}

function serializeEmbedding(values: readonly number[]) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Vetor de embedding inválido.')
  return Buffer.from(new Float32Array(values).buffer)
}

function deserializeEmbedding(value: Buffer, dimensions: number | null): readonly number[] {
  if (dimensions === null || value.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) throw new Error('Vetor persistido com dimensões inválidas.')
  return [...new Float32Array(value.buffer, value.byteOffset, dimensions)]
}

function boundedLimit(value: number, maximum: number) {
  return Math.max(1, Math.min(maximum, Math.trunc(value)))
}
