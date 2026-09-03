import type Database from 'better-sqlite3'
import { executionDecisions, executionStatuses, type ExecutionOverview, type ExecutionRecord } from '../../shared/changeControl'
import { PERSISTENCE_LIMITS } from '../../shared/constants'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

interface ExecutionRow extends ExecutionRecord {
  changeCount: number
  validationCount: number
  checkpointCount: number
}

/** Persists the durable identity and outcome of each agent attempt. */
export class ExecutionRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  create(record: ExecutionRecord) {
    this.database.prepare(`INSERT INTO executions(
      id,workspace,conversation_id,prompt,mode,status,decision,retry_of,
      started_at,finished_at,error
    ) VALUES(@id,@workspace,@conversationId,@prompt,@mode,@status,@decision,@retryOf,
      @startedAt,@finishedAt,@error)`).run(parameters(record))
  }

  update(record: ExecutionRecord) {
    this.database.prepare(`UPDATE executions SET
      prompt=@prompt,mode=@mode,status=@status,decision=@decision,retry_of=@retryOf,
      started_at=@startedAt,finished_at=@finishedAt,error=@error
      WHERE id=@id AND workspace=@workspace AND conversation_id=@conversationId`).run(parameters(record))
  }

  save(record: ExecutionRecord) {
    this.transactions.run('executions.save', () => {
      const exists = this.database.prepare('SELECT 1 FROM executions WHERE id=? AND workspace=?').get(record.id, record.workspace)
      if (exists) this.update(record)
      else this.create(record)
    })
  }

  get(id: string, workspace?: string): ExecutionOverview | null {
    const row = this.database.prepare(selectSql('WHERE e.id=? AND (? IS NULL OR e.workspace=?)')).get(id, workspace ?? null, workspace ?? null) as ExecutionRow | undefined
    return row ? toOverview(row) : null
  }

  list(workspace: string, conversationId?: string, limit = 50): ExecutionOverview[] {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const rows = this.database.prepare(selectSql('WHERE e.workspace=? AND (? IS NULL OR e.conversation_id=?) ORDER BY e.started_at DESC LIMIT ?')).all(workspace, conversationId ?? null, conversationId ?? null, boundedLimit) as ExecutionRow[]
    return rows.map(toOverview)
  }
}

function selectSql(suffix: string) {
  return `SELECT e.id,e.workspace,e.conversation_id conversationId,e.prompt,e.mode,e.status,e.decision,
    e.retry_of retryOf,e.started_at startedAt,e.finished_at finishedAt,e.error,
    (SELECT COUNT(*) FROM changes c WHERE c.execution_id=e.id) changeCount,
    (SELECT COUNT(DISTINCT validation_id) FROM execution_validation_links vl WHERE vl.execution_id=e.id) validationCount,
    (SELECT COUNT(*) FROM checkpoints cp WHERE cp.execution_id=e.id) checkpointCount
    FROM executions e ${suffix}`
}

function parameters(record: ExecutionRecord) {
  return {
    id: record.id,
    workspace: record.workspace,
    conversationId: record.conversationId,
    prompt: record.prompt.slice(0, PERSISTENCE_LIMITS.assistantCharacters),
    mode: record.mode,
    status: record.status,
    decision: record.decision,
    retryOf: record.retryOf,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    error: record.error?.slice(0, PERSISTENCE_LIMITS.metadataCharacters) ?? null,
  }
}

function toOverview(row: ExecutionRow): ExecutionOverview {
  if (!executionStatuses.includes(row.status) || !executionDecisions.includes(row.decision)) {
    throw new Error('A execução persistida possui um estado inválido.')
  }
  return {
    id: row.id,
    workspace: row.workspace,
    conversationId: row.conversationId,
    prompt: row.prompt,
    mode: row.mode,
    status: row.status,
    decision: row.decision,
    retryOf: row.retryOf,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    changeCount: row.changeCount,
    validationCount: row.validationCount,
    checkpointCount: row.checkpointCount,
  }
}
