import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { PERSISTENCE_LIMITS } from '../../shared/constants'
import type { ExecutionCommandRecord, ExecutionErrorRecord, ExecutionValidationLink } from '../../shared/changeControl'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

interface CommandRow extends Omit<ExecutionCommandRecord, 'args'> {
  argsJson: string
}

/** Stores bounded execution evidence and links validation outcomes to changes. */
export class ExecutionEvidenceRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  createCommand(record: ExecutionCommandRecord) {
    this.database.prepare(`INSERT INTO execution_commands(
      id,execution_id,command,args_json,source,status,exit_code,duration_ms,output_summary,started_at,finished_at
    ) VALUES(@id,@executionId,@command,@argsJson,@source,@status,@exitCode,@durationMs,@outputSummary,@startedAt,@finishedAt)`).run(commandParameters(record))
  }

  updateCommand(record: ExecutionCommandRecord) {
    this.database.prepare(`UPDATE execution_commands SET
      command=@command,args_json=@argsJson,source=@source,status=@status,exit_code=@exitCode,
      duration_ms=@durationMs,output_summary=@outputSummary,started_at=@startedAt,finished_at=@finishedAt
      WHERE id=@id AND execution_id=@executionId`).run(commandParameters(record))
  }

  saveCommand(record: ExecutionCommandRecord) {
    this.transactions.run('executionCommands.save', () => {
      const exists = this.database.prepare('SELECT 1 FROM execution_commands WHERE id=? AND execution_id=?').get(record.id, record.executionId)
      if (exists) this.updateCommand(record)
      else this.createCommand(record)
    })
  }

  listCommands(executionId: string, limit = 100): ExecutionCommandRecord[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    const rows = this.database.prepare(`SELECT id,execution_id executionId,command,args_json argsJson,source,status,
      exit_code exitCode,duration_ms durationMs,output_summary outputSummary,started_at startedAt,finished_at finishedAt
      FROM execution_commands WHERE execution_id=? ORDER BY started_at LIMIT ?`).all(executionId, boundedLimit) as CommandRow[]
    return rows.map(fromCommandRow)
  }

  createError(record: ExecutionErrorRecord) {
    this.database.prepare(`INSERT INTO execution_errors(
      id,execution_id,stage,message,path,created_at
    ) VALUES(@id,@executionId,@stage,@message,@path,@createdAt)`).run({
      ...record,
      message: record.message.slice(0, PERSISTENCE_LIMITS.metadataCharacters),
      path: record.path?.slice(0, 4_096) ?? null,
    })
  }

  listErrors(executionId: string, limit = 100): ExecutionErrorRecord[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    return this.database.prepare(`SELECT id,execution_id executionId,stage,message,path,created_at createdAt
      FROM execution_errors WHERE execution_id=? ORDER BY created_at LIMIT ?`).all(executionId, boundedLimit) as ExecutionErrorRecord[]
  }

  linkValidation(link: ExecutionValidationLink) {
    this.database.prepare(`INSERT INTO execution_validation_links(
      id,execution_id,change_id,validation_id,phase,created_at
    ) VALUES(@id,@executionId,@changeId,@validationId,@phase,@createdAt)`).run({
      id: randomUUID(),
      ...link,
      createdAt: new Date().toISOString(),
    })
  }

  listValidationLinks(executionId: string): ExecutionValidationLink[] {
    return this.database.prepare(`SELECT execution_id executionId,change_id changeId,validation_id validationId,phase
      FROM execution_validation_links WHERE execution_id=? ORDER BY created_at`).all(executionId) as ExecutionValidationLink[]
  }
}

function commandParameters(record: ExecutionCommandRecord) {
  return {
    id: record.id,
    executionId: record.executionId,
    command: record.command.slice(0, 4_096),
    argsJson: JSON.stringify(record.args.slice(0, 100).map((arg) => arg.slice(0, 4_096))),
    source: record.source,
    status: record.status,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    outputSummary: record.outputSummary.slice(0, PERSISTENCE_LIMITS.metadataCharacters),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  }
}

function fromCommandRow(row: CommandRow): ExecutionCommandRecord {
  const { argsJson, ...command } = row
  const args: unknown = JSON.parse(argsJson)
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('O histórico de comandos possui argumentos inválidos.')
  return { ...command, args }
}
