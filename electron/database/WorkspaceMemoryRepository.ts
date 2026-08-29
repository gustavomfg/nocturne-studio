import type Database from 'better-sqlite3'

export interface WorkspaceMemoryRow { content: string; updatedAt: string }

export class WorkspaceMemoryRepository {
  constructor(private readonly database: Database.Database) {}

  get(workspace: string): WorkspaceMemoryRow {
    const row = this.database.prepare('SELECT content, updated_at updatedAt FROM workspace_memory WHERE workspace=?').get(workspace) as WorkspaceMemoryRow | undefined
    return row ?? { content: '', updatedAt: '' }
  }

  set(workspace: string, content: string) {
    const updatedAt = new Date().toISOString()
    this.database.prepare(`INSERT INTO workspace_memory(workspace,content,updated_at) VALUES(?,?,?)
      ON CONFLICT(workspace) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at`).run(workspace, content, updatedAt)
    return { content, updatedAt }
  }
}
