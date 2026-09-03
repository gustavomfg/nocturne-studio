import type Database from 'better-sqlite3'
import { changeSetStatuses, changeStatuses, hunkStatuses, type ChangeHunkRecord, type ChangeRecord, type ChangeSetRecord } from '../../shared/changeControl'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

interface ChangeRow extends ChangeRecord {
  beforeHash: string | null
  afterHash: string | null
}

/** Persists the file-level result of one agent mutation attempt. */
export class ChangeSetRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  create(changeSet: ChangeSetRecord) {
    this.database.prepare(`INSERT INTO change_sets(
      id,execution_id,before_checkpoint_id,after_checkpoint_id,status,created_at,updated_at
    ) VALUES(@id,@executionId,@beforeCheckpointId,@afterCheckpointId,@status,@createdAt,@updatedAt)`).run(changeSet)
  }

  update(changeSet: ChangeSetRecord) {
    this.database.prepare(`UPDATE change_sets SET status=@status,updated_at=@updatedAt
      WHERE id=@id AND execution_id=@executionId`).run(changeSet)
  }

  replaceChanges(changeSetId: string, changes: ChangeRecord[]) {
    this.transactions.run('changes.replace', () => {
      this.database.prepare('DELETE FROM changes WHERE change_set_id=?').run(changeSetId)
      const statement = this.database.prepare(`INSERT INTO changes(
        id,change_set_id,execution_id,checkpoint_id,relative_path,original_path,operation,origin,
        before_hash,after_hash,before_size,after_size,status,validation_status,created_at,updated_at
      ) VALUES(@id,@changeSetId,@executionId,@checkpointId,@relativePath,@originalPath,@operation,@origin,
        @beforeHash,@afterHash,@beforeSize,@afterSize,@status,@validationStatus,@createdAt,@updatedAt)`)
      for (const change of changes) statement.run(change)
    })
  }

  save(changeSet: ChangeSetRecord, changes: ChangeRecord[]) {
    this.transactions.run('changes.save', () => {
      const exists = this.database.prepare('SELECT 1 FROM change_sets WHERE id=? AND execution_id=?').get(changeSet.id, changeSet.executionId)
      if (exists) this.update(changeSet)
      else this.create(changeSet)
      this.database.prepare('DELETE FROM changes WHERE change_set_id=?').run(changeSet.id)
      const statement = this.database.prepare(`INSERT INTO changes(
        id,change_set_id,execution_id,checkpoint_id,relative_path,original_path,operation,origin,
        before_hash,after_hash,before_size,after_size,status,validation_status,created_at,updated_at
      ) VALUES(@id,@changeSetId,@executionId,@checkpointId,@relativePath,@originalPath,@operation,@origin,
        @beforeHash,@afterHash,@beforeSize,@afterSize,@status,@validationStatus,@createdAt,@updatedAt)`)
      for (const change of changes) statement.run(change)
    })
  }

  get(id: string, executionId?: string): ChangeSetRecord | null {
    const row = this.database.prepare(`SELECT id,execution_id executionId,before_checkpoint_id beforeCheckpointId,
      after_checkpoint_id afterCheckpointId,status,created_at createdAt,updated_at updatedAt
      FROM change_sets WHERE id=? AND (? IS NULL OR execution_id=?)`).get(id, executionId ?? null, executionId ?? null) as ChangeSetRecord | undefined
    if (row && !changeSetStatuses.includes(row.status)) throw new Error('O ChangeSet persistido possui um estado inválido.')
    return row ?? null
  }

  list(executionId: string): ChangeSetRecord[] {
    const rows = this.database.prepare(`SELECT id,execution_id executionId,before_checkpoint_id beforeCheckpointId,
      after_checkpoint_id afterCheckpointId,status,created_at createdAt,updated_at updatedAt
      FROM change_sets WHERE execution_id=? ORDER BY updated_at DESC`).all(executionId) as ChangeSetRecord[]
    return rows.map((row) => {
      if (!changeSetStatuses.includes(row.status)) throw new Error('O ChangeSet persistido possui um estado inválido.')
      return row
    })
  }

  listChanges(changeSetId: string): ChangeRecord[] {
    const rows = this.database.prepare(`SELECT id,change_set_id changeSetId,execution_id executionId,
      checkpoint_id checkpointId,relative_path relativePath,original_path originalPath,operation,origin,
      before_hash beforeHash,after_hash afterHash,before_size beforeSize,after_size afterSize,status,
      validation_status validationStatus,created_at createdAt,updated_at updatedAt
      FROM changes WHERE change_set_id=? ORDER BY relative_path`).all(changeSetId) as ChangeRow[]
    return rows.map((row) => {
      if (!changeStatuses.includes(row.status)) throw new Error('A mudança persistida possui um estado inválido.')
      return row
    })
  }

  getChange(id: string, executionId?: string): ChangeRecord | null {
    const row = this.database.prepare(`SELECT id,change_set_id changeSetId,execution_id executionId,
      checkpoint_id checkpointId,relative_path relativePath,original_path originalPath,operation,origin,
      before_hash beforeHash,after_hash afterHash,before_size beforeSize,after_size afterSize,status,
      validation_status validationStatus,created_at createdAt,updated_at updatedAt
      FROM changes WHERE id=? AND (? IS NULL OR execution_id=?)`).get(id, executionId ?? null, executionId ?? null) as ChangeRow | undefined
    if (row && !changeStatuses.includes(row.status)) throw new Error('A mudança persistida possui um estado inválido.')
    return row ?? null
  }

  updateChange(change: ChangeRecord) {
    this.database.prepare(`UPDATE changes SET status=@status,validation_status=@validationStatus,
      after_hash=@afterHash,after_size=@afterSize,updated_at=@updatedAt
      WHERE id=@id AND change_set_id=@changeSetId AND execution_id=@executionId`).run(change)
  }

  createHunk(hunk: ChangeHunkRecord) {
    this.database.prepare(`INSERT INTO change_hunks(
      id,change_id,sequence,base_hash,original_patch,final_patch,status,start_line,end_line,decision_at
    ) VALUES(@id,@changeId,@sequence,@baseHash,@originalPatch,@finalPatch,@status,@startLine,@endLine,@decisionAt)`).run(hunk)
  }

  listHunks(changeId: string): ChangeHunkRecord[] {
    const rows = this.database.prepare(`SELECT id,change_id changeId,sequence,base_hash baseHash,
      original_patch originalPatch,final_patch finalPatch,status,start_line startLine,end_line endLine,
      decision_at decisionAt FROM change_hunks WHERE change_id=? ORDER BY sequence`).all(changeId) as ChangeHunkRecord[]
    return rows.map((row) => {
      if (!hunkStatuses.includes(row.status)) throw new Error('O hunk persistido possui um estado inválido.')
      return row
    })
  }

  getHunk(id: string): ChangeHunkRecord | null {
    const row = this.database.prepare(`SELECT id,change_id changeId,sequence,base_hash baseHash,
      original_patch originalPatch,final_patch finalPatch,status,start_line startLine,end_line endLine,
      decision_at decisionAt FROM change_hunks WHERE id=?`).get(id) as ChangeHunkRecord | undefined
    if (row && !hunkStatuses.includes(row.status)) throw new Error('O hunk persistido possui um estado inválido.')
    return row ?? null
  }

  updateHunk(hunk: ChangeHunkRecord) {
    this.database.prepare(`UPDATE change_hunks SET final_patch=@finalPatch,status=@status,decision_at=@decisionAt
      WHERE id=@id AND change_id=@changeId`).run(hunk)
  }

  saveDecision(changeSet: ChangeSetRecord, change: ChangeRecord) {
    this.transactions.run('changes.decision', () => {
      this.update(changeSet)
      this.updateChange(change)
    })
  }
}
