import type Database from 'better-sqlite3'
import type {
  DetectedStack,
  DiscoveryExclusion,
  ProjectExport,
  ProjectImport,
  ProjectIndexFile,
  ProjectIndexRun,
  ProjectIndexSummary,
  ProjectSymbol,
  StackEvidence,
} from '../../shared/codeIntelligence'
import { CODE_INTELLIGENCE_INDEX_VERSION } from '../../shared/codeIntelligence'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

type ProjectIndexFileRow = Omit<ProjectIndexFile, 'excluded'> & { excluded: number }
type ProjectIndexRunRow = ProjectIndexRun

export interface PersistedFileAnalysis {
  file: ProjectIndexFile
  symbols: ProjectSymbol[]
  imports: ProjectImport[]
  exports: ProjectExport[]
}

/** Persists derived project knowledge without storing source contents. */
export class ProjectIndexRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  createRun(run: ProjectIndexRun) {
    this.database.prepare(`INSERT INTO project_index_runs(
      id,workspace,index_version,kind,status,phase,total_files,processed_files,
      failed_files,unsupported_files,pending_files,started_at,updated_at,completed_at,error
    ) VALUES(@id,@workspace,@indexVersion,@kind,@status,@phase,@totalFiles,@processedFiles,
      @failedFiles,@unsupportedFiles,@pendingFiles,@startedAt,@updatedAt,@completedAt,@error)`).run({
      id: run.id,
      workspace: run.workspace,
      indexVersion: run.indexVersion,
      kind: run.kind,
      status: run.status,
      phase: run.phase,
      totalFiles: run.totalFiles,
      processedFiles: run.processedFiles,
      failedFiles: run.failedFiles,
      unsupportedFiles: run.unsupportedFiles,
      pendingFiles: run.pendingFiles,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      error: run.error,
    })
  }

  updateRun(run: ProjectIndexRun) {
    this.database.prepare(`UPDATE project_index_runs SET
      status=@status,phase=@phase,total_files=@totalFiles,processed_files=@processedFiles,
      failed_files=@failedFiles,unsupported_files=@unsupportedFiles,pending_files=@pendingFiles,
      updated_at=@updatedAt,completed_at=@completedAt,error=@error WHERE id=@id AND workspace=@workspace`).run({
      id: run.id,
      workspace: run.workspace,
      status: run.status,
      phase: run.phase,
      totalFiles: run.totalFiles,
      processedFiles: run.processedFiles,
      failedFiles: run.failedFiles,
      unsupportedFiles: run.unsupportedFiles,
      pendingFiles: run.pendingFiles,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      error: run.error,
    })
  }

  latestRun(workspace: string): ProjectIndexRun | null {
    const row = this.database.prepare(`SELECT id,workspace,index_version indexVersion,kind,status,phase,
      total_files totalFiles,processed_files processedFiles,failed_files failedFiles,
      unsupported_files unsupportedFiles,pending_files pendingFiles,started_at startedAt,
      updated_at updatedAt,completed_at completedAt,error
      FROM project_index_runs WHERE workspace=? ORDER BY updated_at DESC LIMIT 1`).get(workspace) as ProjectIndexRunRow | undefined
    return row ?? null
  }

  listRuns(workspace: string, limit = 20): ProjectIndexRun[] {
    return this.database.prepare(`SELECT id,workspace,index_version indexVersion,kind,status,phase,
      total_files totalFiles,processed_files processedFiles,failed_files failedFiles,
      unsupported_files unsupportedFiles,pending_files pendingFiles,started_at startedAt,
      updated_at updatedAt,completed_at completedAt,error
      FROM project_index_runs WHERE workspace=? ORDER BY updated_at DESC LIMIT ?`).all(workspace, Math.max(1, Math.min(100, Math.trunc(limit)))) as ProjectIndexRun[]
  }

  listFiles(workspace: string, limit = 50_000): ProjectIndexFile[] {
    const rows = this.database.prepare(`SELECT workspace,relative_path relativePath,classification,language,
      extension,size,mtime_ms mtimeMs,ctime_ms ctimeMs,mode,observed_hash observedHash,
      analyzed_hash analyzedHash,state,excluded,exclusion_reason exclusionReason,parser_id parserId,
      parser_version parserVersion,error,discovered_at discoveredAt,analyzed_at analyzedAt
      FROM project_index_files WHERE workspace=? ORDER BY relative_path LIMIT ?`).all(workspace, Math.max(1, Math.min(50_000, Math.trunc(limit)))) as ProjectIndexFileRow[]
    return rows.map(toProjectIndexFile)
  }

  getFile(workspace: string, relativePath: string): ProjectIndexFile | null {
    const row = this.database.prepare(`SELECT workspace,relative_path relativePath,classification,language,
      extension,size,mtime_ms mtimeMs,ctime_ms ctimeMs,mode,observed_hash observedHash,
      analyzed_hash analyzedHash,state,excluded,exclusion_reason exclusionReason,parser_id parserId,
      parser_version parserVersion,error,discovered_at discoveredAt,analyzed_at analyzedAt
      FROM project_index_files WHERE workspace=? AND relative_path=?`).get(workspace, relativePath) as ProjectIndexFileRow | undefined
    return row ? toProjectIndexFile(row) : null
  }

  upsertFile(file: ProjectIndexFile) {
    this.database.prepare(`INSERT INTO project_index_files(
      workspace,relative_path,classification,language,extension,size,mtime_ms,ctime_ms,mode,
      observed_hash,analyzed_hash,state,excluded,exclusion_reason,parser_id,parser_version,
      error,discovered_at,analyzed_at
    ) VALUES(@workspace,@relativePath,@classification,@language,@extension,@size,@mtimeMs,@ctimeMs,@mode,
      @observedHash,@analyzedHash,@state,@excluded,@exclusionReason,@parserId,@parserVersion,
      @error,@discoveredAt,@analyzedAt)
    ON CONFLICT(workspace,relative_path) DO UPDATE SET
      classification=excluded.classification,language=excluded.language,extension=excluded.extension,
      size=excluded.size,mtime_ms=excluded.mtime_ms,ctime_ms=excluded.ctime_ms,mode=excluded.mode,
      observed_hash=excluded.observed_hash,analyzed_hash=excluded.analyzed_hash,state=excluded.state,
      excluded=excluded.excluded,exclusion_reason=excluded.exclusion_reason,parser_id=excluded.parser_id,
      parser_version=excluded.parser_version,error=excluded.error,discovered_at=excluded.discovered_at,
      analyzed_at=excluded.analyzed_at`).run({
      ...file,
      excluded: file.excluded ? 1 : 0,
    })
  }

  saveFileAnalysis(value: PersistedFileAnalysis) {
    this.transactions.run('projectIndex.saveFileAnalysis', () => {
      this.upsertFile(value.file)
      this.database.prepare('DELETE FROM project_index_symbols WHERE workspace=? AND relative_path=?').run(value.file.workspace, value.file.relativePath)
      this.database.prepare('DELETE FROM project_index_imports WHERE workspace=? AND source_path=?').run(value.file.workspace, value.file.relativePath)
      this.database.prepare('DELETE FROM project_index_exports WHERE workspace=? AND source_path=?').run(value.file.workspace, value.file.relativePath)
      const symbolStatement = this.database.prepare(`INSERT INTO project_index_symbols(
        id,workspace,relative_path,analyzed_hash,kind,name,qualified_name,scope,signature,
        start_line,start_column,end_line,end_column,exported,parser_id,parser_version
      ) VALUES(@id,@workspace,@relativePath,@analyzedHash,@kind,@name,@qualifiedName,@scope,@signature,
        @startLine,@startColumn,@endLine,@endColumn,@exported,@parserId,@parserVersion)`)
      for (const symbol of value.symbols) symbolStatement.run(symbolParameters(symbol))
      const importStatement = this.database.prepare(`INSERT INTO project_index_imports(
        id,workspace,source_path,source_hash,specifier,target_path,target_hash,kind,imported_names,
        start_line,start_column,end_line,end_column,resolution
      ) VALUES(@id,@workspace,@sourcePath,@sourceHash,@specifier,@targetPath,@targetHash,@kind,@importedNames,
        @startLine,@startColumn,@endLine,@endColumn,@resolution)`)
      for (const relation of value.imports) importStatement.run(importParameters(relation))
      const exportStatement = this.database.prepare(`INSERT INTO project_index_exports(
        id,workspace,source_path,source_hash,name,kind,target_path,target_hash,start_line,start_column,end_line,end_column
      ) VALUES(@id,@workspace,@sourcePath,@sourceHash,@name,@kind,@targetPath,@targetHash,@startLine,@startColumn,@endLine,@endColumn)`)
      for (const relation of value.exports) exportStatement.run(exportParameters(relation))
    })
  }

  markFileState(file: ProjectIndexFile) {
    this.transactions.run('projectIndex.markFileState', () => this.upsertFile(file))
  }

  removeMissingFiles(workspace: string, presentPaths: string[]) {
    this.transactions.run('projectIndex.removeMissingFiles', () => {
      if (!presentPaths.length) {
        this.database.prepare('DELETE FROM project_index_files WHERE workspace=?').run(workspace)
        return
      }
      const placeholders = presentPaths.map(() => '?').join(',')
      this.database.prepare(`DELETE FROM project_index_files WHERE workspace=? AND relative_path NOT IN (${placeholders})`).run(workspace, ...presentPaths)
    })
  }

  replaceStackEvidence(workspace: string, evidence: StackEvidence[]) {
    this.transactions.run('projectIndex.replaceStackEvidence', () => {
      this.database.prepare('DELETE FROM project_stack_evidence WHERE workspace=?').run(workspace)
      const statement = this.database.prepare(`INSERT INTO project_stack_evidence(
        id,workspace,category,value,confidence,source_path,source_hash,source_line,reason,detected_at
      ) VALUES(@id,@workspace,@category,@value,@confidence,@sourcePath,@sourceHash,@sourceLine,@reason,@detectedAt)`)
      for (const item of evidence) statement.run({
        id: item.id,
        workspace: item.workspace,
        category: item.category,
        value: item.value,
        confidence: item.confidence,
        sourcePath: item.sourcePath,
        sourceHash: item.sourceHash,
        sourceLine: item.sourceLine,
        reason: item.reason,
        detectedAt: item.detectedAt,
      })
    })
  }

  replaceExclusions(workspace: string, exclusions: DiscoveryExclusion[], detectedAt = new Date().toISOString()) {
    this.transactions.run('projectIndex.replaceExclusions', () => {
      this.database.prepare('DELETE FROM project_index_exclusions WHERE workspace=?').run(workspace)
      const statement = this.database.prepare(`INSERT INTO project_index_exclusions(
        workspace,relative_path,reason,detected_at
      ) VALUES(?,?,?,?)`)
      for (const item of exclusions) statement.run(workspace, item.relativePath, item.reason, detectedAt)
    })
  }

  upsertExclusions(workspace: string, exclusions: DiscoveryExclusion[], detectedAt = new Date().toISOString()) {
    this.transactions.run('projectIndex.upsertExclusions', () => {
      const statement = this.database.prepare(`INSERT INTO project_index_exclusions(
        workspace,relative_path,reason,detected_at
      ) VALUES(?,?,?,?) ON CONFLICT(workspace,relative_path) DO UPDATE SET
        reason=excluded.reason,detected_at=excluded.detected_at`)
      for (const item of exclusions) statement.run(workspace, item.relativePath, item.reason, detectedAt)
    })
  }

  removeMissingForChange(workspace: string, requestedPaths: string[], presentPaths: string[]) {
    this.transactions.run('projectIndex.removeMissingForChange', () => {
      const existing = this.database.prepare('SELECT relative_path relativePath FROM project_index_files WHERE workspace=?').all(workspace) as Array<{ relativePath: string }>
      const present = new Set(presentPaths)
      const normalized = requestedPaths.filter(Boolean).map((item) => item.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''))
      const remove = existing.filter((row) => normalized.some((requested) => row.relativePath === requested || row.relativePath.startsWith(`${requested}/`)) && !present.has(row.relativePath))
      const statement = this.database.prepare('DELETE FROM project_index_files WHERE workspace=? AND relative_path=?')
      for (const row of remove) statement.run(workspace, row.relativePath)
    })
  }

  listExclusions(workspace: string): DiscoveryExclusion[] {
    return this.database.prepare(`SELECT relative_path relativePath,reason
      FROM project_index_exclusions WHERE workspace=? ORDER BY relative_path`).all(workspace) as DiscoveryExclusion[]
  }

  listStackEvidence(workspace: string): StackEvidence[] {
    return this.database.prepare(`SELECT id,workspace,category,value,confidence,source_path sourcePath,
      source_hash sourceHash,source_line sourceLine,reason,detected_at detectedAt
      FROM project_stack_evidence WHERE workspace=? ORDER BY category,value,source_path`).all(workspace) as StackEvidence[]
  }

  listSymbols(workspace: string, query = '', limit = 100): ProjectSymbol[] {
    const normalized = query.trim()
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.database.prepare(`SELECT id,workspace,relative_path relativePath,analyzed_hash analyzedHash,
      kind,name,qualified_name qualifiedName,scope,signature,start_line startLine,start_column startColumn,
      end_line endLine,end_column endColumn,exported,parser_id parserId,parser_version parserVersion
      FROM project_index_symbols
      WHERE workspace=? AND (?='' OR lower(name) LIKE lower(?) OR lower(COALESCE(qualified_name,'')) LIKE lower(?))
      ORDER BY relative_path,start_line,name LIMIT ?`).all(workspace, normalized, `%${normalized}%`, `%${normalized}%`, boundedLimit) as Array<{
        id: string
        workspace: string
        relativePath: string
        analyzedHash: string
        kind: ProjectSymbol['kind']
        name: string
        qualifiedName: string | null
        scope: string | null
        signature: string | null
        startLine: number
        startColumn: number
        endLine: number
        endColumn: number
        exported: number
        parserId: string
        parserVersion: string
      }>
    return rows.map((row) => ({ ...row, exported: Boolean(row.exported), location: { startLine: row.startLine, startColumn: row.startColumn, endLine: row.endLine, endColumn: row.endColumn } }))
  }

  listImports(workspace: string, relativePath?: string): ProjectImport[] {
    const rows = this.database.prepare(`SELECT id,workspace,source_path sourcePath,source_hash sourceHash,
      specifier,target_path targetPath,target_hash targetHash,kind,imported_names importedNames,
      start_line startLine,start_column startColumn,end_line endLine,end_column endColumn,resolution
      FROM project_index_imports WHERE workspace=? AND (? IS NULL OR source_path=?)
      ORDER BY source_path,start_line`).all(workspace, relativePath ?? null, relativePath ?? null) as Array<{
        id: string
        workspace: string
        sourcePath: string
        sourceHash: string
        specifier: string
        targetPath: string | null
        targetHash: string | null
        kind: ProjectImport['kind']
        importedNames: string
        startLine: number
        startColumn: number
        endLine: number
        endColumn: number
        resolution: ProjectImport['resolution']
      }>
    return rows.map((row) => ({ ...row, importedNames: parseStringArray(row.importedNames), location: { startLine: row.startLine, startColumn: row.startColumn, endLine: row.endLine, endColumn: row.endColumn } }))
  }

  listExports(workspace: string, relativePath?: string): ProjectExport[] {
    const rows = this.database.prepare(`SELECT id,workspace,source_path sourcePath,source_hash sourceHash,
      name,kind,target_path targetPath,target_hash targetHash,start_line startLine,start_column startColumn,
      end_line endLine,end_column endColumn FROM project_index_exports
      WHERE workspace=? AND (? IS NULL OR source_path=?) ORDER BY source_path,start_line`).all(workspace, relativePath ?? null, relativePath ?? null) as Array<Omit<ProjectExport, 'location'> & { startLine: number; startColumn: number; endLine: number; endColumn: number }>
    return rows.map((row) => ({ ...row, location: { startLine: row.startLine, startColumn: row.startColumn, endLine: row.endLine, endColumn: row.endColumn } }))
  }

  refreshRelationHashes(workspace: string) {
    this.transactions.run('projectIndex.refreshRelationHashes', () => {
      this.database.prepare(`UPDATE project_index_imports SET target_hash=(
        SELECT analyzed_hash FROM project_index_files target
        WHERE target.workspace=project_index_imports.workspace AND target.relative_path=project_index_imports.target_path
      ) WHERE workspace=? AND target_path IS NOT NULL`).run(workspace)
      this.database.prepare(`UPDATE project_index_exports SET target_hash=(
        SELECT analyzed_hash FROM project_index_files target
        WHERE target.workspace=project_index_exports.workspace AND target.relative_path=project_index_exports.target_path
      ) WHERE workspace=? AND target_path IS NOT NULL`).run(workspace)
    })
  }

  summary(workspace: string): ProjectIndexSummary {
    const counts = this.database.prepare(`SELECT COUNT(*) files,
      SUM(CASE WHEN state='indexed' THEN 1 ELSE 0 END) indexedFiles,
      SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failedFiles,
      SUM(CASE WHEN state='unsupported' THEN 1 ELSE 0 END) unsupportedFiles
      FROM project_index_files WHERE workspace=?`).get(workspace) as { files: number; indexedFiles: number; failedFiles: number; unsupportedFiles: number }
    const symbols = this.database.prepare('SELECT COUNT(*) count FROM project_index_symbols WHERE workspace=?').get(workspace) as { count: number }
    const imports = this.database.prepare('SELECT COUNT(*) count FROM project_index_imports WHERE workspace=?').get(workspace) as { count: number }
    const exports = this.database.prepare('SELECT COUNT(*) count FROM project_index_exports WHERE workspace=?').get(workspace) as { count: number }
    const evidence = this.listStackEvidence(workspace)
    const stack = evidence.length ? stackFromEvidence(workspace, evidence) : null
    return {
      workspace,
      indexVersion: CODE_INTELLIGENCE_INDEX_VERSION,
      latestRun: this.latestRun(workspace),
      files: counts.files ?? 0,
      indexedFiles: counts.indexedFiles ?? 0,
      failedFiles: counts.failedFiles ?? 0,
      unsupportedFiles: counts.unsupportedFiles ?? 0,
      symbols: symbols.count,
      imports: imports.count,
      exports: exports.count,
      stack,
    }
  }
}

function toProjectIndexFile(row: ProjectIndexFileRow): ProjectIndexFile {
  return { ...row, excluded: Boolean(row.excluded) }
}

function symbolParameters(symbol: ProjectSymbol) {
  return {
    id: symbol.id,
    workspace: symbol.workspace,
    relativePath: symbol.relativePath,
    analyzedHash: symbol.analyzedHash,
    kind: symbol.kind,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    scope: symbol.scope,
    signature: symbol.signature,
    startLine: symbol.location.startLine,
    startColumn: symbol.location.startColumn,
    endLine: symbol.location.endLine,
    endColumn: symbol.location.endColumn,
    exported: symbol.exported ? 1 : 0,
    parserId: symbol.parserId,
    parserVersion: symbol.parserVersion,
  }
}

function importParameters(relation: ProjectImport) {
  return {
    id: relation.id,
    workspace: relation.workspace,
    sourcePath: relation.sourcePath,
    sourceHash: relation.sourceHash,
    specifier: relation.specifier,
    targetPath: relation.targetPath,
    targetHash: relation.targetHash,
    kind: relation.kind,
    importedNames: JSON.stringify(relation.importedNames),
    startLine: relation.location.startLine,
    startColumn: relation.location.startColumn,
    endLine: relation.location.endLine,
    endColumn: relation.location.endColumn,
    resolution: relation.resolution,
  }
}

function exportParameters(relation: ProjectExport) {
  return {
    id: relation.id,
    workspace: relation.workspace,
    sourcePath: relation.sourcePath,
    sourceHash: relation.sourceHash,
    name: relation.name,
    kind: relation.kind,
    targetPath: relation.targetPath,
    targetHash: relation.targetHash,
    startLine: relation.location.startLine,
    startColumn: relation.location.startColumn,
    endLine: relation.location.endLine,
    endColumn: relation.location.endColumn,
  }
}

function parseStringArray(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('A relação persistida possui nomes importados inválidos.')
  return parsed
}

function stackFromEvidence(workspace: string, evidence: StackEvidence[]): DetectedStack {
  const values = (category: StackEvidence['category']) => [...new Set(evidence.filter((item) => item.category === category).map((item) => item.value))]
  const languages = values('language')
  return {
    name: workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace,
    stack: [...new Set(evidence.filter((item) => ['runtime', 'framework', 'bundler', 'package-manager', 'typecheck', 'lint', 'test', 'build'].includes(item.category)).map((item) => item.value))],
    primaryLanguage: languages[0] ?? 'Desconhecida',
    commands: Object.fromEntries(evidence.filter((item) => item.category === 'script').map((item) => {
      const separator = item.value.indexOf('=')
      return separator > 0 ? [item.value.slice(0, separator), item.value.slice(separator + 1)] : [item.value, item.value]
    })),
    evidence,
    detectedAt: evidence.reduce((latest, item) => item.detectedAt > latest ? item.detectedAt : latest, ''),
  }
}
