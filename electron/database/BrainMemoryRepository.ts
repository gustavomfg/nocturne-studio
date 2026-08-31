import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BrainMemory,
  BrainMemoryCandidate,
  BrainMemoryHistoryAction,
  BrainMemoryHistoryEntry,
  CreateBrainMemoryInput,
  UpdateBrainMemoryInput,
} from '../../shared/brainMemory'
import type { ConversationRow } from './ConversationRepository'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

type ConversationLookup = (id: string) => ConversationRow | null

/** Owns structured memory, its lifecycle, search and audit history. */
export class BrainMemoryRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly getConversation: ConversationLookup,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  create(workspaceId: string, value: CreateBrainMemoryInput): BrainMemory {
    const conversationId = value.scope === 'conversation' ? value.conversationId ?? null : null
    this.assertScope(workspaceId, value.scope, conversationId)
    const now = new Date().toISOString()
    const row: BrainMemory = {
      id: randomUUID(),
      workspaceId,
      conversationId,
      kind: value.kind,
      scope: value.scope,
      status: value.status ?? 'candidate',
      content: value.content.trim(),
      confidence: value.confidence ?? 70,
      sourceType: value.sourceType ?? 'manual',
      sourceId: value.sourceId ?? null,
      createdAt: now,
      updatedAt: now,
      lastConfirmedAt: value.status === 'active' ? now : null,
      lastUsedAt: null,
      useCount: 0,
    }
    this.transactions.run('brainMemories.create', () => {
      this.database.prepare(`INSERT INTO brain_memories(
        id,workspace_id,conversation_id,kind,scope,status,content,confidence,
        source_type,source_id,created_at,updated_at,last_confirmed_at,last_used_at,use_count
      ) VALUES(
        @id,@workspaceId,@conversationId,@kind,@scope,@status,@content,@confidence,
        @sourceType,@sourceId,@createdAt,@updatedAt,@lastConfirmedAt,@lastUsedAt,@useCount
      )`).run(row)
      const summary = row.sourceType === 'agent'
        ? 'Candidata proposta pelo agente.'
        : row.sourceType === 'message'
          ? 'Memória criada a partir de uma mensagem.'
          : 'Memória criada manualmente.'
      this.addHistory(row.id, 'created', null, row.status, summary, now)
    })
    return row
  }

  update(id: string, workspaceId: string, value: UpdateBrainMemoryInput): BrainMemory {
    const current = this.get(id, workspaceId)
    if (!current) throw new Error('Memória não encontrada.')
    const scope = value.scope ?? current.scope
    const conversationId = scope === 'conversation'
      ? value.conversationId === undefined ? current.conversationId : value.conversationId
      : null
    this.assertScope(workspaceId, scope, conversationId)
    const status = value.status ?? current.status
    const transitions: Record<BrainMemory['status'], BrainMemory['status'][]> = {
      candidate: ['active', 'archived'],
      active: ['outdated', 'archived'],
      outdated: ['active', 'archived'],
      archived: ['active'],
    }
    if (status !== current.status && !transitions[current.status].includes(status)) {
      throw new Error(`Transição de memória inválida: ${current.status} → ${status}.`)
    }
    const updatedAt = new Date().toISOString()
    const next = {
      id,
      workspaceId,
      conversationId,
      kind: value.kind ?? current.kind,
      scope,
      status,
      content: value.content?.trim() ?? current.content,
      confidence: value.confidence ?? current.confidence,
      updatedAt,
      lastConfirmedAt: status === 'active' && current.status !== 'active'
        ? updatedAt
        : current.lastConfirmedAt,
    }
    this.transactions.run('brainMemories.update', () => {
      this.database.prepare(`UPDATE brain_memories SET
        conversation_id=@conversationId,kind=@kind,scope=@scope,status=@status,
        content=@content,confidence=@confidence,updated_at=@updatedAt,
        last_confirmed_at=@lastConfirmedAt
        WHERE id=@id AND workspace_id=@workspaceId`).run(next)
      const edited = next.content !== current.content
        || next.kind !== current.kind
        || next.scope !== current.scope
        || next.confidence !== current.confidence
      if (edited) {
        this.addHistory(id, 'edited', current.status, status,
          'Conteúdo ou classificação da memória atualizado.', updatedAt)
      }
      if (status !== current.status) {
        const action = brainMemoryStatusAction(current.status, status)
        this.addHistory(id, action, current.status, status,
          brainMemoryHistorySummary(action), updatedAt)
      }
    })
    return this.get(id, workspaceId) as BrainMemory
  }

  listHistory(id: string, workspaceId: string): BrainMemoryHistoryEntry[] {
    if (!this.get(id, workspaceId)) throw new Error('Memória não encontrada.')
    return this.database.prepare(`SELECT id,memory_id memoryId,action,
      from_status fromStatus,to_status toStatus,summary,created_at createdAt
      FROM brain_memory_history WHERE memory_id=?
      ORDER BY created_at DESC,rowid DESC LIMIT 500`).all(id) as BrainMemoryHistoryEntry[]
  }

  delete(id: string, workspaceId: string) {
    return this.database.prepare(
      'DELETE FROM brain_memories WHERE id=? AND workspace_id=?',
    ).run(id, workspaceId).changes > 0
  }

  get(id: string, workspaceId: string): BrainMemory | null {
    const row = this.database.prepare(`${brainMemorySelect}
      WHERE id=? AND workspace_id=?`).get(id, workspaceId) as BrainMemory | undefined
    return row ?? null
  }

  findEquivalent(
    workspaceId: string,
    scope: BrainMemory['scope'],
    conversationId: string | null,
    content: string,
  ): BrainMemory | null {
    const row = this.database.prepare(`${brainMemorySelect}
      WHERE workspace_id=? AND scope=? AND conversation_id IS ?
        AND content=? COLLATE NOCASE
        AND status IN ('candidate','active') LIMIT 1`)
      .get(workspaceId, scope, conversationId, content.trim()) as BrainMemory | undefined
    return row ?? null
  }

  createCandidates(
    workspaceId: string,
    currentConversationId: string,
    candidates: BrainMemoryCandidate[],
  ) {
    return this.transactions.run('brainMemories.createCandidates', () => candidates.flatMap((candidate) => {
      const conversationId = candidate.scope === 'conversation' ? currentConversationId : null
      if (this.findEquivalent(workspaceId, candidate.scope, conversationId, candidate.content)) return []
      return [this.create(workspaceId, {
        ...candidate,
        conversationId: conversationId ?? undefined,
        sourceType: 'agent',
        status: 'candidate',
      })]
    }))
  }

  listPage(workspaceId: string, offset = 0, limit = 50, query = '', status?: BrainMemory['status']) {
    const search = buildFtsQuery(query)
    const statusFilter = status ? ' AND memory.status=@status' : ''
    if (search) {
      const rows = this.database.prepare(`${brainMemorySearchSelect}
        WHERE memory.workspace_id=@workspaceId${statusFilter}
          AND brain_memories_fts MATCH @search
        ORDER BY bm25(brain_memories_fts), memory.updated_at DESC
        LIMIT @fetch OFFSET @offset`).all({
        workspaceId,
        status,
        search,
        fetch: limit + 1,
        offset,
      }) as BrainMemory[]
      return { items: rows.slice(0, limit), hasMore: rows.length > limit }
    }
    const rows = this.database.prepare(`${brainMemorySelect}
      WHERE workspace_id=@workspaceId${status ? ' AND status=@status' : ''}
      ORDER BY updated_at DESC LIMIT @fetch OFFSET @offset`).all({
      workspaceId,
      status,
      fetch: limit + 1,
      offset,
    }) as BrainMemory[]
    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  retrieve(workspaceId: string, conversationId: string, query: string, limit = 8): BrainMemory[] {
    const search = buildFtsQuery(query)
    if (!search) return []
    return this.database.prepare(`${brainMemorySearchSelect}
      WHERE memory.workspace_id=@workspaceId AND memory.status='active'
        AND (memory.scope='workspace' OR memory.conversation_id=@conversationId)
        AND brain_memories_fts MATCH @search
      ORDER BY bm25(brain_memories_fts), memory.confidence DESC,
        memory.updated_at DESC LIMIT @limit`).all({
      workspaceId,
      conversationId,
      search,
      limit,
    }) as BrainMemory[]
  }

  markUsed(ids: string[]) {
    const unique = [...new Set(ids)].slice(0, 50)
    if (!unique.length) return
    this.database.prepare(`UPDATE brain_memories
      SET last_used_at=?,use_count=use_count+1
      WHERE id IN (${unique.map(() => '?').join(',')})`)
      .run(new Date().toISOString(), ...unique)
  }

  private assertScope(
    workspaceId: string,
    scope: BrainMemory['scope'],
    conversationId: string | null,
  ) {
    if (scope === 'workspace' && conversationId) {
      throw new Error('Memória do workspace não pode pertencer a uma conversa.')
    }
    if (scope === 'conversation') {
      if (!conversationId) throw new Error('Memória da conversa exige uma conversa válida.')
      const conversation = this.getConversation(conversationId)
      if (!conversation || conversation.workspace !== workspaceId) {
        throw new Error('A conversa da memória não pertence ao workspace atual.')
      }
    }
  }

  private addHistory(
    memoryId: string,
    action: BrainMemoryHistoryAction,
    fromStatus: BrainMemory['status'] | null,
    toStatus: BrainMemory['status'],
    summary: string,
    createdAt: string,
  ) {
    this.database.prepare(`INSERT INTO brain_memory_history(
      id,memory_id,action,from_status,to_status,summary,created_at
    ) VALUES(?,?,?,?,?,?,?)`).run(
      randomUUID(), memoryId, action, fromStatus, toStatus, summary, createdAt,
    )
  }
}

const brainMemoryColumns = (prefix = '') => `${prefix}id,${prefix}workspace_id workspaceId,
  ${prefix}conversation_id conversationId,${prefix}kind,${prefix}scope,${prefix}status,
  ${prefix}content,${prefix}confidence,${prefix}source_type sourceType,
  ${prefix}source_id sourceId,${prefix}created_at createdAt,
  ${prefix}updated_at updatedAt,${prefix}last_confirmed_at lastConfirmedAt,
  ${prefix}last_used_at lastUsedAt,${prefix}use_count useCount`
const brainMemorySelect = `SELECT ${brainMemoryColumns()} FROM brain_memories`
const brainMemorySearchSelect = `SELECT ${brainMemoryColumns('memory.')}
  FROM brain_memories memory JOIN brain_memories_fts
  ON brain_memories_fts.rowid=memory.rowid`

function brainMemoryStatusAction(
  from: BrainMemory['status'],
  to: BrainMemory['status'],
): BrainMemoryHistoryAction {
  if (from === 'candidate' && to === 'active') return 'approved'
  if (from === 'candidate' && to === 'archived') return 'disapproved'
  if (to === 'archived') return 'archived'
  if (to === 'outdated') return 'marked-outdated'
  return 'restored'
}

function brainMemoryHistorySummary(action: BrainMemoryHistoryAction) {
  return ({
    created: 'Memória criada.',
    edited: 'Memória editada.',
    approved: 'Memória aprovada para uso pelo agente.',
    disapproved: 'Candidata desaprovada.',
    'marked-outdated': 'Memória marcada como desatualizada.',
    archived: 'Memória arquivada.',
    restored: 'Memória restaurada e aprovada novamente.',
  } as const)[action]
}

function buildFtsQuery(value: string) {
  const tokens = value.normalize('NFKC').match(/[\p{L}\p{N}_-]{2,}/gu)?.slice(0, 12) ?? []
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ')
}
