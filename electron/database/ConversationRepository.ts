import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { PERSISTENCE_LIMITS } from '../../shared/constants'
import { serializeJsonValue } from '../../shared/json'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

export interface ConversationRow {
  id: string
  title: string
  workspace: string
  codexThreadId: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageRow {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: string | null
  createdAt: string
}

export class ConversationRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  list(): ConversationRow[] {
    return this.database.prepare(`SELECT id, title, workspace,
      codex_thread_id codexThreadId, created_at createdAt, updated_at updatedAt FROM conversations ORDER BY updated_at DESC`).all() as ConversationRow[]
  }

  page(offset = 0, limit = 100) {
    const rows = this.database.prepare(`SELECT id, title, workspace,
      codex_thread_id codexThreadId, created_at createdAt, updated_at updatedAt FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(limit + 1, offset) as ConversationRow[]
    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  get(id: string): ConversationRow | null {
    return this.database.prepare(`SELECT id, title, workspace,
      codex_thread_id codexThreadId, created_at createdAt, updated_at updatedAt FROM conversations WHERE id=?`).get(id) as ConversationRow | undefined ?? null
  }

  create(workspace: string): ConversationRow {
    const now = new Date().toISOString()
    const row = { id: randomUUID(), title: 'Nova conversa', workspace, codexThreadId: null, createdAt: now, updatedAt: now }
    this.database.prepare(`INSERT INTO conversations (id,title,workspace,created_at,updated_at) VALUES (@id,@title,@workspace,@createdAt,@updatedAt)`).run(row)
    return row
  }

  renameFromPrompt(id: string, prompt: string) {
    const title = prompt.replace(/\s+/g, ' ').trim().slice(0, 52) || 'Nova conversa'
    this.database.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?').run(title, new Date().toISOString(), id)
  }

  setCodexThread(id: string, threadId: string | null) {
    const normalized = threadId?.trim() || null
    if (normalized && normalized.length > 512) throw new Error('Identificador de thread Codex inválido.')
    const changed = this.database.prepare('UPDATE conversations SET codex_thread_id=? WHERE id=?').run(normalized, id)
    if (!changed.changes) throw new Error('Conversa não encontrada.')
  }

  delete(id: string) {
    this.database.prepare('DELETE FROM conversations WHERE id=?').run(id)
  }

  listMessages(conversationId: string): MessageRow[] {
    return this.database.prepare(`SELECT id, conversation_id conversationId, role, content, metadata,
      created_at createdAt FROM messages WHERE conversation_id=? ORDER BY created_at, rowid`).all(conversationId) as MessageRow[]
  }

  listRecentMessages(conversationId: string, limit = 100): MessageRow[] {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const rows = this.database.prepare(`SELECT id, conversation_id conversationId, role, content, metadata, created_at createdAt
      FROM messages WHERE conversation_id=? AND role IN ('user','assistant')
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(conversationId, boundedLimit) as MessageRow[]
    return rows.reverse()
  }

  pageMessages(conversationId: string, offset = 0, limit = 100) {
    const rows = this.database.prepare(`SELECT id, conversation_id conversationId, role, content, metadata, created_at createdAt
      FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(conversationId, limit + 1, offset) as MessageRow[]
    return { items: rows.slice(0, limit).reverse(), hasMore: rows.length > limit }
  }

  addMessage(conversationId: string, role: MessageRow['role'], content: string, metadata?: unknown) {
    return this.transactions.run('conversations.addMessage', () => this.insertMessage(conversationId, role, content, metadata))
  }

  insertMessage(conversationId: string, role: MessageRow['role'], content: string, metadata?: unknown) {
    const serializedMetadata = metadata === undefined || metadata === null ? null : serializeJsonValue(metadata, PERSISTENCE_LIMITS.metadataCharacters)
    const row: MessageRow = { id: randomUUID(), conversationId, role, content, metadata: serializedMetadata, createdAt: new Date().toISOString() }
    this.database.prepare(`INSERT INTO messages (id,conversation_id,role,content,metadata,created_at)
      VALUES (@id,@conversationId,@role,@content,@metadata,@createdAt)`).run(row)
    this.database.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(row.createdAt, conversationId)
    return row
  }
}
