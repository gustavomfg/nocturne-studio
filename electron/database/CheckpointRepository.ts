import type Database from 'better-sqlite3'
import type { CheckpointFileRecord, CheckpointRecord } from '../../shared/changeControl'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

interface CheckpointFileRow extends Omit<CheckpointFileRecord, 'exists'> {
  existsFlag: number
}

/** Stores checkpoint manifests; file bytes live in the private app-data store. */
export class CheckpointRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  create(checkpoint: CheckpointRecord) {
    this.database.prepare(`INSERT INTO checkpoints(
      id,execution_id,workspace,phase,status,captured_at,root_path,error
    ) VALUES(@id,@executionId,@workspace,@phase,@status,@capturedAt,@rootPath,@error)`).run(checkpoint)
  }

  update(checkpoint: CheckpointRecord) {
    this.database.prepare(`UPDATE checkpoints SET status=@status,captured_at=@capturedAt,
      root_path=@rootPath,error=@error WHERE id=@id AND execution_id=@executionId`).run(checkpoint)
  }

  save(checkpoint: CheckpointRecord) {
    this.transactions.run('checkpoints.save', () => {
      const exists = this.database.prepare('SELECT 1 FROM checkpoints WHERE id=? AND execution_id=?').get(checkpoint.id, checkpoint.executionId)
      if (exists) this.update(checkpoint)
      else this.create(checkpoint)
    })
  }

  replaceFiles(checkpointId: string, files: CheckpointFileRecord[]) {
    this.transactions.run('checkpoints.replaceFiles', () => {
      this.database.prepare('DELETE FROM checkpoint_files WHERE checkpoint_id=?').run(checkpointId)
      const statement = this.database.prepare(`INSERT INTO checkpoint_files(
        id,checkpoint_id,relative_path,exists_flag,kind,size,mode,hash,content_path
      ) VALUES(@id,@checkpointId,@relativePath,@existsFlag,@kind,@size,@mode,@hash,@contentPath)`)
      for (const file of files) statement.run({
        id: file.id,
        checkpointId: file.checkpointId,
        relativePath: file.relativePath,
        existsFlag: file.exists ? 1 : 0,
        kind: file.kind,
        size: file.size,
        mode: file.mode,
        hash: file.hash,
        contentPath: file.contentPath,
      })
    })
  }

  get(id: string, executionId?: string): CheckpointRecord | null {
    const row = this.database.prepare(`SELECT id,execution_id executionId,workspace,phase,status,
      captured_at capturedAt,root_path rootPath,error FROM checkpoints
      WHERE id=? AND (? IS NULL OR execution_id=?)`).get(id, executionId ?? null, executionId ?? null) as CheckpointRecord | undefined
    return row ?? null
  }

  list(executionId: string): CheckpointRecord[] {
    return this.database.prepare(`SELECT id,execution_id executionId,workspace,phase,status,
      captured_at capturedAt,root_path rootPath,error FROM checkpoints
      WHERE execution_id=? ORDER BY captured_at`).all(executionId) as CheckpointRecord[]
  }

  listFiles(checkpointId: string): CheckpointFileRecord[] {
    const rows = this.database.prepare(`SELECT id,checkpoint_id checkpointId,relative_path relativePath,
      exists_flag existsFlag,kind,size,mode,hash,content_path contentPath
      FROM checkpoint_files WHERE checkpoint_id=? ORDER BY relative_path`).all(checkpointId) as CheckpointFileRow[]
    return rows.map((row) => ({ ...row, exists: Boolean(row.existsFlag) }))
  }
}
