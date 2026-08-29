import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { PERSISTENCE_LIMITS } from '../../shared/constants'
import { serializeJsonValue } from '../../shared/json'

export interface ArtifactRow {
  id: string
  conversationId: string
  workspace: string
  type: string
  title: string
  filePath: string | null
  content: string | null
  metadata: string | null
  createdAt: string
  updatedAt: string
}

export class ArtifactRepository {
  constructor(private readonly database: Database.Database) {}

  list(conversationId: string): ArtifactRow[] {
    return this.database.prepare(`SELECT id,conversation_id conversationId,workspace,type,title,file_path filePath,
      content,metadata,created_at createdAt,updated_at updatedAt FROM artifacts
      WHERE conversation_id=? ORDER BY updated_at DESC`).all(conversationId) as ArtifactRow[]
  }

  page(conversationId: string, offset = 0, limit = 50) {
    const rows = this.database.prepare(`SELECT id,conversation_id conversationId,workspace,type,title,file_path filePath,
      content,metadata,created_at createdAt,updated_at updatedAt FROM artifacts
      WHERE conversation_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(conversationId, limit + 1, offset) as ArtifactRow[]
    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  add(conversationId: string, workspace: string, type: string, title: string, filePath?: string | null, content?: string | null, metadata?: unknown) {
    const now = new Date().toISOString()
    const existing = filePath ? this.database.prepare('SELECT id,created_at createdAt FROM artifacts WHERE conversation_id=? AND file_path=? ORDER BY updated_at DESC LIMIT 1').get(conversationId, filePath) as { id: string; createdAt: string } | undefined : undefined
    const serializedMetadata = metadata === undefined || metadata === null ? null : serializeJsonValue(metadata, PERSISTENCE_LIMITS.metadataCharacters)
    const row: ArtifactRow = { id: existing?.id ?? randomUUID(), conversationId, workspace, type, title, filePath: filePath ?? null, content: content ?? null, metadata: serializedMetadata, createdAt: existing?.createdAt ?? now, updatedAt: now }
    this.database.prepare(`INSERT INTO artifacts(id,conversation_id,workspace,type,title,file_path,content,metadata,created_at,updated_at)
      VALUES(@id,@conversationId,@workspace,@type,@title,@filePath,@content,@metadata,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,content=excluded.content,metadata=excluded.metadata,updated_at=excluded.updated_at`).run(row)
    return row
  }

  delete(id: string, conversationId: string) {
    return this.database.prepare('DELETE FROM artifacts WHERE id=? AND conversation_id=?').run(id, conversationId).changes > 0
  }
}
