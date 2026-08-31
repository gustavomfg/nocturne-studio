import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

/** Owns the audit trail for explicit execution approvals. */
export class ApprovalRepository {
  constructor(private readonly database: Database.Database) {}

  record(key: string, accepted: boolean, command?: string, risk?: string) {
    this.database.prepare(`INSERT INTO approval_audit(
      id,approval_key,decision,command,risk,created_at
    ) VALUES(?,?,?,?,?,?)`).run(
      randomUUID(),
      key,
      accepted ? 'accepted' : 'declined',
      command?.slice(0, 4_000) ?? null,
      risk ?? null,
      new Date().toISOString(),
    )
  }
}
