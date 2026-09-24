import type Database from 'better-sqlite3'
import type { ValidationArtifact, ValidationRun } from '../../shared/codeIntelligence'
import { CODE_INTELLIGENCE_LIMITS, COLLECTION_PAGE_LIMITS } from '../../shared/constants'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'
import { WorkspaceEvidenceRepository } from './WorkspaceEvidenceRepository'

interface ValidationRunRow {
  id: string
  workspace: string
  executionId: string | null
  kind: ValidationRun['kind']
  command: string
  argsJson: string
  status: ValidationRun['status']
  exitCode: number | null
  durationMs: number | null
  outputSummary: string
  artifactsJson: string
  startedAt: string
  completedAt: string | null
  error: string | null
}

/** Stores bounded, structured validation outcomes without retaining raw process logs. */
export class ValidationRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  create(run: ValidationRun) {
    this.transactions.run('validation.create', () => {
      const evidence = new WorkspaceEvidenceRepository(this.database)
      evidence.record({ kind: 'validation', sourceId: run.id, workspace: run.workspace, executionId: run.executionId, startedAt: run.startedAt, references: [...evidence.indexReferences(run.workspace), ...evidence.checkpointReferences(run.executionId)] })
      this.database.prepare(`INSERT INTO validation_runs(
        id,workspace,execution_id,kind,command,args_json,status,exit_code,duration_ms,output_summary,
        artifacts_json,started_at,completed_at,error
      ) VALUES(@id,@workspace,@executionId,@kind,@command,@argsJson,@status,@exitCode,@durationMs,@outputSummary,
        @artifactsJson,@startedAt,@completedAt,@error)`).run(toParameters(run))
    })
  }

  update(run: ValidationRun) {
    this.database.prepare(`UPDATE validation_runs SET
      execution_id=@executionId,command=@command,args_json=@argsJson,status=@status,exit_code=@exitCode,duration_ms=@durationMs,
      output_summary=@outputSummary,artifacts_json=@artifactsJson,completed_at=@completedAt,error=@error
      WHERE id=@id AND workspace=@workspace`).run(toParameters(run))
  }

  latest(workspace: string) {
    const row = this.database.prepare(selectSql(`WHERE workspace=? ORDER BY started_at DESC,id DESC LIMIT 1`)).get(workspace) as ValidationRunRow | undefined
    return row ? fromRow(row) : null
  }

  list(workspace: string, limit?: number) {
    const boundedLimit = Math.max(1, Math.min(CODE_INTELLIGENCE_LIMITS.maxQueryResults, Math.trunc(limit ?? CODE_INTELLIGENCE_LIMITS.maxQueryResults)))
    const rows = this.database.prepare(selectSql('WHERE workspace=? ORDER BY started_at DESC,id DESC LIMIT ?')).all(workspace, boundedLimit) as ValidationRunRow[]
    return rows.map(fromRow)
  }

  page(workspace: string, offset = 0, limit: number = COLLECTION_PAGE_LIMITS.validation) {
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const boundedLimit = Math.max(1, Math.min(CODE_INTELLIGENCE_LIMITS.maxQueryResults, Math.trunc(limit)))
    const rows = this.database.prepare(selectSql('WHERE workspace=? ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?'))
      .all(workspace, boundedLimit + 1, boundedOffset) as ValidationRunRow[]
    return { items: rows.slice(0, boundedLimit).map(fromRow), hasMore: rows.length > boundedLimit }
  }

  save(run: ValidationRun) {
    this.transactions.run('validation.save', () => {
      const exists = this.database.prepare('SELECT 1 FROM validation_runs WHERE id=? AND workspace=?').get(run.id, run.workspace)
      if (exists) this.update(run)
      else this.create(run)
    })
  }
}

function selectSql(suffix: string) {
  return `SELECT id,workspace,execution_id executionId,kind,command,args_json argsJson,status,exit_code exitCode,
    duration_ms durationMs,output_summary outputSummary,artifacts_json artifactsJson,
    started_at startedAt,completed_at completedAt,error
    FROM validation_runs ${suffix}`
}

function toParameters(run: ValidationRun) {
  return {
    id: run.id,
    workspace: run.workspace,
    executionId: run.executionId ?? null,
    kind: run.kind,
    command: run.command,
    argsJson: JSON.stringify(run.args),
    status: run.status,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    outputSummary: run.outputSummary,
    artifactsJson: JSON.stringify(run.artifacts),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
  }
}

function fromRow(row: ValidationRunRow): ValidationRun {
  return {
    id: row.id,
    workspace: row.workspace,
    ...(row.executionId ? { executionId: row.executionId } : {}),
    kind: row.kind,
    command: row.command,
    args: parseArgs(row.argsJson),
    status: row.status,
    exitCode: row.exitCode,
    durationMs: row.durationMs,
    outputSummary: row.outputSummary,
    artifacts: parseArtifacts(row.artifactsJson),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: row.error,
  }
}

function parseArgs(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('A execução de validação persistida possui argumentos inválidos.')
  return parsed
}

function parseArtifacts(value: string): ValidationArtifact[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('A execução de validação persistida possui artefatos inválidos.')
  return parsed.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('A execução de validação persistida possui um artefato inválido.')
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || typeof record.kind !== 'string' || (record.size !== null && typeof record.size !== 'number')) {
      throw new Error('A execução de validação persistida possui um artefato inválido.')
    }
    return { path: record.path, kind: record.kind, size: record.size } satisfies ValidationArtifact
  })
}
