import Database from 'better-sqlite3'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { suggestionIdentity, type ReviewComparisonItem, type Suggestion, type SuggestionInput, type SuggestionReconciliation, type SuggestionStatus } from '../../shared/suggestions'
import type { BrainMemory, BrainMemoryCandidate, BrainMemoryHistoryAction, BrainMemoryHistoryEntry, CreateBrainMemoryInput, UpdateBrainMemoryInput } from '../../shared/brainMemory'
import { DATABASE_SCHEMA_VERSION, PERSISTENCE_LIMITS } from '../../shared/constants'
import { serializeJsonValue } from '../../shared/json'
import { migrateDatabase } from './migrations'
import { ProviderConfigurationRepository } from './ProviderConfigurationRepository'
import { ModelCatalogRepository } from './ModelCatalogRepository'
import { WorkspaceModelBindingRepository } from './WorkspaceModelBindingRepository'

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

export interface WorkspaceRow { path: string; name: string; favorite: boolean; authorized: boolean; createdAt: string; lastOpenedAt: string }
export interface ArtifactRow { id: string; conversationId: string; workspace: string; type: string; title: string; filePath: string | null; content: string | null; metadata: string | null; createdAt: string; updatedAt: string }

const importColumns: Record<string, ReadonlySet<string>> = {
  workspaces: new Set(['path', 'name', 'favorite', 'authorized', 'created_at', 'last_opened_at']),
  conversations: new Set(['id', 'title', 'workspace', 'codex_thread_id', 'created_at', 'updated_at']),
  messages: new Set(['id', 'conversation_id', 'role', 'content', 'metadata', 'created_at']),
  artifacts: new Set(['id', 'conversation_id', 'workspace', 'type', 'title', 'file_path', 'content', 'metadata', 'created_at', 'updated_at']),
  workspace_memory: new Set(['workspace', 'content', 'updated_at']),
  suggestions: new Set(['id', 'workspace_id', 'conversation_id', 'title', 'description', 'reasoning', 'category', 'severity', 'affected_files', 'proposed_changes', 'expected_benefits', 'complexity', 'risk', 'evidence', 'confidence', 'source', 'responsible', 'status', 'result', 'created_at', 'updated_at']),
  suggestion_decisions: new Set(['id', 'suggestion_id', 'status', 'result', 'created_at']),
  brain_memories: new Set(['id', 'workspace_id', 'conversation_id', 'kind', 'scope', 'status', 'content', 'confidence', 'source_type', 'source_id', 'created_at', 'updated_at', 'last_confirmed_at', 'last_used_at', 'use_count']),
  brain_memory_history: new Set(['id', 'memory_id', 'action', 'from_status', 'to_status', 'summary', 'created_at']),
  provider_configs: new Set(['id', 'provider_type', 'display_name', 'source', 'base_url', 'enabled', 'requires_authentication', 'timeout_ms', 'created_at', 'updated_at']),
  model_catalog: new Set(['provider_id', 'model_id', 'descriptor', 'updated_at']),
  workspace_model_bindings: new Set(['workspace_id', 'bindings', 'updated_at']),
}
const exportTables = ['conversations', 'workspaces', 'messages', 'artifacts', 'workspace_memory', 'brain_memories', 'brain_memory_history', 'suggestions', 'suggestion_decisions', 'provider_configs', 'model_catalog', 'workspace_model_bindings', 'settings'] as const
const MIGRATION_BACKUP_PREFIX = 'nocturne.db.backup-'
const MIGRATION_BACKUP_RETENTION = 3

export class LocalDatabase {
  private db: Database.Database
  private readonly databasePath: string
  readonly providerConfigurations: ProviderConfigurationRepository
  readonly modelCatalog: ModelCatalogRepository
  readonly workspaceModelBindings: WorkspaceModelBindingRepository

  constructor(userDataPath: string) {
    this.databasePath = path.join(userDataPath, 'nocturne.db')
    restrictFileIfPresent(this.databasePath)
    this.db = new Database(this.databasePath)
    restrictFileIfPresent(this.databasePath)
    const schemaVersion = this.db.pragma('user_version', { simple: true }) as number
    if (schemaVersion > DATABASE_SCHEMA_VERSION) {
      this.db.close()
      throw new Error(`Este banco usa o schema ${schemaVersion}, mas esta versão do Nocturne suporta até o schema ${DATABASE_SCHEMA_VERSION}. Atualize o aplicativo antes de abrir estes dados.`)
    }
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    // FULL adds stronger commit-time synchronization in WAL mode, improving
    // durability across OS/power failures while retaining SQLite transactions.
    this.db.pragma('synchronous = FULL')
    this.db.pragma('temp_store = MEMORY')
    this.restrictDatabaseFiles()
    if (schemaVersion > 0 && schemaVersion < DATABASE_SCHEMA_VERSION && fs.existsSync(this.databasePath)) {
      try {
        this.createMigrationBackup()
      } catch (error) {
        this.db.close()
        throw error
      }
    }
    try {
      migrateDatabase(this.db, schemaVersion)
    } catch (error) {
      this.db.close()
      throw new Error(`A migração do banco falhou e foi revertida integralmente: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.restrictDatabaseFiles()
    this.providerConfigurations = new ProviderConfigurationRepository(this.db)
    this.modelCatalog = new ModelCatalogRepository(this.db)
    this.workspaceModelBindings = new WorkspaceModelBindingRepository(this.db)
    this.runScheduledIntegrityCheck()
    this.cleanupOrphans()
  }

  runInTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation)()
  }

  listConversations(): ConversationRow[] {
    return this.db.prepare(`SELECT id, title, workspace,
      codex_thread_id codexThreadId, created_at createdAt, updated_at updatedAt FROM conversations ORDER BY updated_at DESC`).all() as ConversationRow[]
  }

  listConversationPage(offset = 0, limit = 100) {
    const rows = this.db.prepare(`SELECT id, title, workspace,
      codex_thread_id codexThreadId, created_at createdAt, updated_at updatedAt FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(limit + 1, offset) as ConversationRow[]
    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  getConversation(id: string): ConversationRow | null {
    return this.db.prepare(`SELECT id, title, workspace,
      codex_thread_id codexThreadId, created_at createdAt, updated_at updatedAt FROM conversations WHERE id=?`).get(id) as ConversationRow | undefined ?? null
  }

  async createRecoverySnapshot(retain = 5) {
    const directory = path.join(path.dirname(this.databasePath), 'backups')
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(directory, `nocturne-before-restore-${timestamp}.db`)
    try {
      await this.db.backup(destination)
      await fs.promises.chmod(destination, 0o600)
      const snapshots = (await fs.promises.readdir(directory)).filter((name) => name.startsWith('nocturne-before-restore-') && name.endsWith('.db')).sort().reverse()
      await Promise.all(snapshots.slice(Math.max(1, retain)).map((name) => fs.promises.unlink(path.join(directory, name))))
      return destination
    } catch (error) {
      await fs.promises.unlink(destination).catch(() => undefined)
      throw new Error(`Não foi possível criar o ponto de recuperação: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  createConversation(workspace: string): ConversationRow {
    this.touchWorkspace(workspace)
    const now = new Date().toISOString()
    const row = { id: randomUUID(), title: 'Nova conversa', workspace, codexThreadId: null, createdAt: now, updatedAt: now }
    this.db.prepare(`INSERT INTO conversations (id,title,workspace,created_at,updated_at) VALUES (@id,@title,@workspace,@createdAt,@updatedAt)`).run(row)
    return row
  }

  listWorkspaces(): WorkspaceRow[] {
    const rows = this.db.prepare(`SELECT path, name, favorite, authorized, created_at createdAt, last_opened_at lastOpenedAt
      FROM workspaces ORDER BY favorite DESC, last_opened_at DESC`).all() as Array<Omit<WorkspaceRow, 'favorite' | 'authorized'> & { favorite: number; authorized: number }>
    return rows.map((row) => ({ ...row, favorite: Boolean(row.favorite), authorized: Boolean(row.authorized) }))
  }

  touchWorkspace(workspace: string) {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO workspaces(path,name,authorized,created_at,last_opened_at) VALUES(?,?,1,?,?)
      ON CONFLICT(path) DO UPDATE SET name=excluded.name,authorized=1,last_opened_at=excluded.last_opened_at`)
      .run(workspace, path.basename(workspace), now, now)
  }

  relocateWorkspace(source: string, destination: string) {
    if (source === destination) {
      this.touchWorkspace(destination)
      return
    }
    const modelBindings = this.workspaceModelBindings.get(source)
    const relocate = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT path,name,favorite,authorized,created_at createdAt,last_opened_at lastOpenedAt
        FROM workspaces WHERE path=?`).get(source) as {
        path: string
        name: string
        favorite: number
        authorized: number
        createdAt: string
        lastOpenedAt: string
      } | undefined
      if (!current) throw new Error('Workspace original não encontrado no histórico local.')
      if (this.db.prepare('SELECT 1 FROM workspaces WHERE path=?').get(destination)) {
        throw new Error('A pasta selecionada já pertence a outro workspace salvo.')
      }

      const now = new Date().toISOString()
      this.db.prepare(`INSERT INTO workspaces(path,name,favorite,authorized,created_at,last_opened_at)
        VALUES(?,?,?,1,?,?)`).run(destination, path.basename(destination), current.favorite, current.createdAt, now)
      this.db.prepare('UPDATE conversations SET workspace=? WHERE workspace=?').run(destination, source)
      this.db.prepare('UPDATE artifacts SET workspace=? WHERE workspace=?').run(destination, source)
      this.db.prepare('UPDATE workspace_memory SET workspace=? WHERE workspace=?').run(destination, source)
      this.db.prepare('UPDATE suggestions SET workspace_id=? WHERE workspace_id=?').run(destination, source)
      this.db.prepare('UPDATE brain_memories SET workspace_id=? WHERE workspace_id=?').run(destination, source)
      if (modelBindings) {
        this.workspaceModelBindings.set({ ...modelBindings, workspaceId: destination })
        this.workspaceModelBindings.delete(source)
      }
      this.db.prepare('DELETE FROM workspaces WHERE path=?').run(source)
    })
    relocate()
  }

  removeWorkspace(workspace: string) { this.db.prepare('DELETE FROM workspaces WHERE path=?').run(workspace) }
  setWorkspaceFavorite(workspace: string, favorite: boolean) { this.db.prepare('UPDATE workspaces SET favorite=? WHERE path=?').run(favorite ? 1 : 0, workspace) }

  getSettings(): Record<string, string> {
    const rows = this.db.prepare("SELECT key,value FROM settings WHERE key NOT LIKE 'maintenance.%'").all() as Array<{ key: string; value: string }>
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    if (settings.approvalPolicy !== 'untrusted') settings.approvalPolicy = 'on-request'
    settings.theme = 'dark'
    if (settings.language !== 'en') settings.language = 'pt-BR'
    return settings
  }

  setSettings(values: Record<string, string>) {
    const statement = this.db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    this.db.transaction(() => Object.entries(values).forEach(([key, value]) => statement.run(key, value)))()
  }

  getWorkspaceMemory(workspace: string) {
    const row = this.db.prepare('SELECT content, updated_at updatedAt FROM workspace_memory WHERE workspace=?').get(workspace) as { content: string; updatedAt: string } | undefined
    return row ?? { content: '', updatedAt: '' }
  }

  setWorkspaceMemory(workspace: string, content: string) {
    const updatedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO workspace_memory(workspace,content,updated_at) VALUES(?,?,?)
      ON CONFLICT(workspace) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at`).run(workspace, content, updatedAt)
    return { content, updatedAt }
  }

  createBrainMemory(workspaceId: string, value: CreateBrainMemoryInput): BrainMemory {
    const conversationId = value.scope === 'conversation' ? value.conversationId ?? null : null
    this.assertBrainMemoryScope(workspaceId, value.scope, conversationId)
    const now = new Date().toISOString()
    const row: BrainMemory = {
      id: randomUUID(), workspaceId, conversationId, kind: value.kind, scope: value.scope,
      status: value.status ?? 'candidate', content: value.content.trim(), confidence: value.confidence ?? 70,
      sourceType: value.sourceType ?? 'manual', sourceId: value.sourceId ?? null,
      createdAt: now, updatedAt: now, lastConfirmedAt: value.status === 'active' ? now : null,
      lastUsedAt: null, useCount: 0,
    }
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO brain_memories(id,workspace_id,conversation_id,kind,scope,status,content,confidence,source_type,source_id,created_at,updated_at,last_confirmed_at,last_used_at,use_count)
        VALUES(@id,@workspaceId,@conversationId,@kind,@scope,@status,@content,@confidence,@sourceType,@sourceId,@createdAt,@updatedAt,@lastConfirmedAt,@lastUsedAt,@useCount)`).run(row)
      const summary = row.sourceType === 'agent' ? 'Candidata proposta pelo agente.' : row.sourceType === 'message' ? 'Memória criada a partir de uma mensagem.' : 'Memória criada manualmente.'
      this.addBrainMemoryHistory(row.id, 'created', null, row.status, summary, now)
    })()
    return row
  }

  updateBrainMemory(id: string, workspaceId: string, value: UpdateBrainMemoryInput): BrainMemory {
    const current = this.getBrainMemory(id, workspaceId)
    if (!current) throw new Error('Memória não encontrada.')
    const scope = value.scope ?? current.scope
    const conversationId = scope === 'conversation' ? value.conversationId === undefined ? current.conversationId : value.conversationId : null
    this.assertBrainMemoryScope(workspaceId, scope, conversationId)
    const status = value.status ?? current.status
    const transitions: Record<BrainMemory['status'], BrainMemory['status'][]> = {
      candidate: ['active', 'archived'], active: ['outdated', 'archived'], outdated: ['active', 'archived'], archived: ['active'],
    }
    if (status !== current.status && !transitions[current.status].includes(status)) throw new Error(`Transição de memória inválida: ${current.status} → ${status}.`)
    const updatedAt = new Date().toISOString()
    const next = {
      id, workspaceId, conversationId, kind: value.kind ?? current.kind, scope, status,
      content: value.content?.trim() ?? current.content, confidence: value.confidence ?? current.confidence,
      updatedAt, lastConfirmedAt: status === 'active' && current.status !== 'active' ? updatedAt : current.lastConfirmedAt,
    }
    this.db.transaction(() => {
      this.db.prepare(`UPDATE brain_memories SET conversation_id=@conversationId,kind=@kind,scope=@scope,status=@status,content=@content,confidence=@confidence,updated_at=@updatedAt,last_confirmed_at=@lastConfirmedAt WHERE id=@id AND workspace_id=@workspaceId`).run(next)
      const edited = next.content !== current.content || next.kind !== current.kind || next.scope !== current.scope || next.confidence !== current.confidence
      if (edited) this.addBrainMemoryHistory(id, 'edited', current.status, status, 'Conteúdo ou classificação da memória atualizado.', updatedAt)
      if (status !== current.status) {
        const action = brainMemoryStatusAction(current.status, status)
        this.addBrainMemoryHistory(id, action, current.status, status, brainMemoryHistorySummary(action), updatedAt)
      }
    })()
    return this.getBrainMemory(id, workspaceId) as BrainMemory
  }

  listBrainMemoryHistory(id: string, workspaceId: string): BrainMemoryHistoryEntry[] {
    if (!this.getBrainMemory(id, workspaceId)) throw new Error('Memória não encontrada.')
    return this.db.prepare(`SELECT id,memory_id memoryId,action,from_status fromStatus,to_status toStatus,summary,created_at createdAt
      FROM brain_memory_history WHERE memory_id=? ORDER BY created_at DESC,rowid DESC LIMIT 500`).all(id) as BrainMemoryHistoryEntry[]
  }

  deleteBrainMemory(id: string, workspaceId: string) {
    return this.db.prepare('DELETE FROM brain_memories WHERE id=? AND workspace_id=?').run(id, workspaceId).changes > 0
  }

  getBrainMemory(id: string, workspaceId: string): BrainMemory | null {
    const row = this.db.prepare(`${brainMemorySelect} WHERE id=? AND workspace_id=?`).get(id, workspaceId) as BrainMemory | undefined
    return row ?? null
  }

  findEquivalentBrainMemory(workspaceId: string, scope: BrainMemory['scope'], conversationId: string | null, content: string): BrainMemory | null {
    const row = this.db.prepare(`${brainMemorySelect} WHERE workspace_id=? AND scope=? AND conversation_id IS ? AND content=? COLLATE NOCASE AND status IN ('candidate','active') LIMIT 1`).get(workspaceId, scope, conversationId, content.trim()) as BrainMemory | undefined
    return row ?? null
  }

  createBrainMemoryCandidates(workspaceId: string, currentConversationId: string, candidates: BrainMemoryCandidate[]) {
    return this.db.transaction(() => candidates.flatMap((candidate) => {
      const conversationId = candidate.scope === 'conversation' ? currentConversationId : null
      if (this.findEquivalentBrainMemory(workspaceId, candidate.scope, conversationId, candidate.content)) return []
      return [this.createBrainMemory(workspaceId, { ...candidate, conversationId: conversationId ?? undefined, sourceType: 'agent', status: 'candidate' })]
    }))()
  }

  listBrainMemoryPage(workspaceId: string, offset = 0, limit = 50, query = '', status?: BrainMemory['status']) {
    const search = buildFtsQuery(query)
    const statusFilter = status ? ' AND memory.status=@status' : ''
    if (search) {
      const rows = this.db.prepare(`${brainMemorySearchSelect} WHERE memory.workspace_id=@workspaceId${statusFilter} AND brain_memories_fts MATCH @search ORDER BY bm25(brain_memories_fts), memory.updated_at DESC LIMIT @fetch OFFSET @offset`).all({ workspaceId, status, search, fetch: limit + 1, offset }) as BrainMemory[]
      return { items: rows.slice(0, limit), hasMore: rows.length > limit }
    }
    const rows = this.db.prepare(`${brainMemorySelect} WHERE workspace_id=@workspaceId${status ? ' AND status=@status' : ''} ORDER BY updated_at DESC LIMIT @fetch OFFSET @offset`).all({ workspaceId, status, fetch: limit + 1, offset }) as BrainMemory[]
    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  retrieveBrainMemories(workspaceId: string, conversationId: string, query: string, limit = 8): BrainMemory[] {
    const search = buildFtsQuery(query)
    if (!search) return []
    return this.db.prepare(`${brainMemorySearchSelect} WHERE memory.workspace_id=@workspaceId AND memory.status='active' AND (memory.scope='workspace' OR memory.conversation_id=@conversationId) AND brain_memories_fts MATCH @search ORDER BY bm25(brain_memories_fts), memory.confidence DESC, memory.updated_at DESC LIMIT @limit`).all({ workspaceId, conversationId, search, limit }) as BrainMemory[]
  }

  markBrainMemoriesUsed(ids: string[]) {
    const unique = [...new Set(ids)].slice(0, 50)
    if (!unique.length) return
    this.db.prepare(`UPDATE brain_memories SET last_used_at=?,use_count=use_count+1 WHERE id IN (${unique.map(() => '?').join(',')})`).run(new Date().toISOString(), ...unique)
  }

  private assertBrainMemoryScope(workspaceId: string, scope: BrainMemory['scope'], conversationId: string | null) {
    if (scope === 'workspace' && conversationId) throw new Error('Memória do workspace não pode pertencer a uma conversa.')
    if (scope === 'conversation') {
      if (!conversationId) throw new Error('Memória da conversa exige uma conversa válida.')
      const conversation = this.getConversation(conversationId)
      if (!conversation || conversation.workspace !== workspaceId) throw new Error('A conversa da memória não pertence ao workspace atual.')
    }
  }

  listArtifacts(conversationId: string): ArtifactRow[] {
    return this.db.prepare(`SELECT id,conversation_id conversationId,workspace,type,title,file_path filePath,
      content,metadata,created_at createdAt,updated_at updatedAt FROM artifacts
      WHERE conversation_id=? ORDER BY updated_at DESC`).all(conversationId) as ArtifactRow[]
  }

  listArtifactPage(conversationId: string, offset = 0, limit = 50) {
    const rows = this.db.prepare(`SELECT id,conversation_id conversationId,workspace,type,title,file_path filePath,
      content,metadata,created_at createdAt,updated_at updatedAt FROM artifacts
      WHERE conversation_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(conversationId, limit + 1, offset) as ArtifactRow[]
    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  addArtifact(conversationId: string, workspace: string, type: string, title: string, filePath?: string | null, content?: string | null, metadata?: unknown) {
    const now = new Date().toISOString()
    const existing = filePath ? this.db.prepare('SELECT id,created_at createdAt FROM artifacts WHERE conversation_id=? AND file_path=? ORDER BY updated_at DESC LIMIT 1').get(conversationId, filePath) as { id: string; createdAt: string } | undefined : undefined
    const serializedMetadata = metadata === undefined || metadata === null ? null : serializeJsonValue(metadata, PERSISTENCE_LIMITS.metadataCharacters)
    const row: ArtifactRow = { id: existing?.id ?? randomUUID(), conversationId, workspace, type, title, filePath: filePath ?? null, content: content ?? null, metadata: serializedMetadata, createdAt: existing?.createdAt ?? now, updatedAt: now }
    this.db.prepare(`INSERT INTO artifacts(id,conversation_id,workspace,type,title,file_path,content,metadata,created_at,updated_at)
      VALUES(@id,@conversationId,@workspace,@type,@title,@filePath,@content,@metadata,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,content=excluded.content,metadata=excluded.metadata,updated_at=excluded.updated_at`).run(row)
    return row
  }

  saveAssistantTurn(conversationId: string, workspace: string, content: string, metadata: unknown, artifacts: Array<{ type: string; title: string; filePath?: string | null; content?: string | null; metadata?: unknown }> = []) {
    return this.db.transaction(() => {
      const message = this.insertMessage(conversationId, 'assistant', content, metadata)
      this.addArtifact(conversationId, workspace, 'markdown', `Resposta · ${new Date().toLocaleString()}`, null, content)
      for (const artifact of artifacts) this.addArtifact(conversationId, workspace, artifact.type, artifact.title, artifact.filePath, artifact.content, artifact.metadata)
      return message
    })()
  }

  deleteArtifact(id: string, conversationId: string) {
    return this.db.prepare('DELETE FROM artifacts WHERE id=? AND conversation_id=?').run(id, conversationId).changes > 0
  }
  recordApproval(key: string, accepted: boolean, command?: string, risk?: string) { this.db.prepare('INSERT INTO approval_audit(id,approval_key,decision,command,risk,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), key, accepted ? 'accepted' : 'declined', command?.slice(0, 4_000) ?? null, risk ?? null, new Date().toISOString()) }

  listSuggestions(conversationId: string): Suggestion[] {
    const rows = this.db.prepare(`${suggestionSelect} WHERE conversation_id=? AND status IN ('new','in-analysis','accepted','deferred') ORDER BY updated_at DESC`).all(conversationId) as EncodedSuggestion[]
    return this.decodeSuggestions(rows)
  }

  listSuggestionPage(conversationId: string, offset = 0, limit = 50) {
    const rows = this.db.prepare(`${suggestionSelect} WHERE conversation_id=? AND status IN ('new','in-analysis','accepted','deferred') ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(conversationId, limit + 1, offset) as EncodedSuggestion[]
    return { items: this.decodeSuggestions(rows.slice(0, limit)), hasMore: rows.length > limit }
  }

  getSuggestion(id: string, conversationId?: string): Suggestion | null {
    const row = this.db.prepare(`${suggestionSelect} WHERE id=?${conversationId ? ' AND conversation_id=?' : ''}`).get(...(conversationId ? [id, conversationId] : [id])) as EncodedSuggestion | undefined
    return row ? this.decodeSuggestions([row])[0] : null
  }

  addSuggestion(conversationId: string, workspaceId: string, value: SuggestionInput): Suggestion {
    const now = new Date().toISOString()
    const decisionId = randomUUID()
    const row: Suggestion = {
      id: randomUUID(), workspaceId, conversationId, ...value,
      evidence: value.evidence ?? [],
      confidence: value.confidence ?? 60,
      source: value.source ?? 'Análise do agente',
      responsible: value.responsible ?? 'Agente de revisão',
      status: 'new', createdAt: now, updatedAt: now,
      history: [{ id: decisionId, status: 'new', result: null, createdAt: now }],
    }
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO suggestions(id,workspace_id,conversation_id,title,description,reasoning,category,severity,affected_files,proposed_changes,expected_benefits,complexity,risk,evidence,confidence,source,responsible,status,created_at,updated_at) VALUES(@id,@workspaceId,@conversationId,@title,@description,@reasoning,@category,@severity,@affectedFiles,@proposedChanges,@expectedBenefits,@complexity,@risk,@evidence,@confidence,@source,@responsible,@status,@createdAt,@updatedAt)`).run({ ...row, affectedFiles: JSON.stringify(row.affectedFiles), expectedBenefits: JSON.stringify(row.expectedBenefits), evidence: JSON.stringify(row.evidence) })
      this.db.prepare('INSERT INTO suggestion_decisions(id,suggestion_id,status,result,created_at) VALUES(?,?,?,?,?)').run(decisionId, row.id, 'new', null, now)
    })()
    return row
  }

  reconcileSuggestions(conversationId: string, workspaceId: string, values: SuggestionInput[]): SuggestionReconciliation {
    return this.db.transaction(() => {
      const history = this.listSuggestionHistory(conversationId)
      const byIdentity = new Map<string, Suggestion>()
      const activeBefore = new Map<string, Suggestion>()
      for (const suggestion of history) {
        const identity = suggestionIdentity(suggestion)
        const existing = byIdentity.get(identity)
        const suggestionIsActive = isActiveSuggestionStatus(suggestion.status)
        const existingIsActive = existing ? isActiveSuggestionStatus(existing.status) : false
        if (!existing || (!existingIsActive && suggestionIsActive) || (existing.status === 'new' && suggestion.status === 'accepted')) byIdentity.set(identity, suggestion)
        if (suggestionIsActive && !activeBefore.has(identity)) activeBefore.set(identity, suggestion)
      }
      const seen = new Set<string>()
      const newSuggestions: ReviewComparisonItem[] = []
      const persistentSuggestions: ReviewComparisonItem[] = []
      const severityChanges: SuggestionReconciliation['comparison']['severityChanges'] = []
      const suggestions = values.map((value) => {
        const identity = suggestionIdentity(value)
        seen.add(identity)
        const existing = byIdentity.get(identity)
        if (!existing) {
          const created = this.addSuggestion(conversationId, workspaceId, value)
          byIdentity.set(identity, created)
          newSuggestions.push(comparisonItem(created))
          return created
        }
        if (!isActiveSuggestionStatus(existing.status)) return existing
        persistentSuggestions.push(comparisonItem(existing))
        if (existing.severity !== value.severity) {
          severityChanges.push({
            id: existing.id,
            title: existing.title,
            from: existing.severity,
            to: value.severity,
          })
        }
        if (!['new', 'in-analysis', 'deferred'].includes(existing.status)) return existing
        const updatedAt = new Date().toISOString()
        this.db.prepare(`UPDATE suggestions SET title=@title,description=@description,reasoning=@reasoning,category=@category,severity=@severity,
          affected_files=@affectedFiles,proposed_changes=@proposedChanges,expected_benefits=@expectedBenefits,complexity=@complexity,risk=@risk,
          evidence=@evidence,confidence=@confidence,source=@source,responsible=@responsible,updated_at=@updatedAt
          WHERE id=@id AND conversation_id=@conversationId AND status IN ('new','in-analysis','deferred')`).run({
          ...value, id: existing.id, conversationId, affectedFiles: JSON.stringify(value.affectedFiles),
          expectedBenefits: JSON.stringify(value.expectedBenefits), evidence: JSON.stringify(value.evidence ?? []),
          confidence: value.confidence ?? 60, source: value.source ?? 'Análise do agente',
          responsible: value.responsible ?? 'Agente de revisão', updatedAt,
        })
        const updated = this.getSuggestion(existing.id, conversationId) as Suggestion
        byIdentity.set(identity, updated)
        return updated
      })
      const resolvedSuggestions: ReviewComparisonItem[] = []
      for (const [identity, suggestion] of activeBefore) {
        if (seen.has(identity) || !['new', 'in-analysis'].includes(suggestion.status)) continue
        const resolved = this.setSuggestionStatus(
          suggestion.id,
          'resolved',
          'A sugestão não reapareceu na revisão estruturada atual.',
        )
        resolvedSuggestions.push(comparisonItem(resolved))
      }
      return {
        suggestions,
        comparison: {
          reviewedAt: new Date().toISOString(),
          newSuggestions,
          persistentSuggestions,
          resolvedSuggestions,
          severityChanges,
        },
      }
    })()
  }

  private listSuggestionHistory(conversationId: string): Suggestion[] {
    const rows = this.db.prepare(`${suggestionSelect} WHERE conversation_id=? ORDER BY updated_at DESC`).all(conversationId) as EncodedSuggestion[]
    return this.decodeSuggestions(rows)
  }

  setSuggestionStatus(id: string, status: SuggestionStatus, result?: string): Suggestion {
    return this.db.transaction(() => {
      const updatedAt = new Date().toISOString()
      const current = this.db.prepare('SELECT status FROM suggestions WHERE id=?').get(id) as { status: SuggestionStatus } | undefined
      if (!current) throw new Error('Sugestão não encontrada.')
      const allowed: Record<SuggestionStatus, SuggestionStatus[]> = {
        new: ['in-analysis', 'accepted', 'rejected', 'resolved', 'deferred', 'invalid'],
        'in-analysis': ['accepted', 'rejected', 'resolved', 'deferred', 'invalid'],
        accepted: ['resolved', 'rejected', 'deferred', 'invalid'],
        deferred: ['in-analysis', 'accepted', 'rejected', 'resolved', 'invalid'],
        rejected: [],
        resolved: [],
        invalid: [],
      }
      if (current.status === status) return this.getSuggestion(id) as Suggestion
      if (!allowed[current.status].includes(status)) throw new Error(`Transição de sugestão inválida: ${current.status} → ${status}.`)
      const normalizedResult = result?.slice(0, 20_000) ?? null
      const changed = this.db.prepare('UPDATE suggestions SET status=?,result=?,updated_at=? WHERE id=?').run(status, normalizedResult, updatedAt, id)
      if (!changed.changes) throw new Error('Sugestão não encontrada.')
      this.db.prepare('INSERT INTO suggestion_decisions(id,suggestion_id,status,result,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), id, status, normalizedResult, updatedAt)
      const row = this.db.prepare('SELECT conversation_id conversationId FROM suggestions WHERE id=?').get(id) as { conversationId: string }
      return this.getSuggestion(id, row.conversationId) as Suggestion
    })()
  }

  private decodeSuggestions(rows: EncodedSuggestion[]): Suggestion[] {
    if (!rows.length) return []
    const identifiers = rows.map((row) => row.id)
    const placeholders = identifiers.map(() => '?').join(',')
    const decisions = this.db.prepare(`SELECT id,suggestion_id suggestionId,status,result,created_at createdAt
      FROM suggestion_decisions WHERE suggestion_id IN (${placeholders}) ORDER BY created_at,rowid`).all(...identifiers) as Array<{
        id: string
        suggestionId: string
        status: SuggestionStatus
        result: string | null
        createdAt: string
      }>
    const history = new Map<string, Suggestion['history']>()
    for (const decision of decisions) {
      const entries = history.get(decision.suggestionId) ?? []
      entries.push({ id: decision.id, status: decision.status, result: decision.result, createdAt: decision.createdAt })
      history.set(decision.suggestionId, entries)
    }
    return decodeSuggestions(rows).map((suggestion) => ({
      ...suggestion,
      history: history.get(suggestion.id) ?? [{
        id: `legacy-${suggestion.id}`,
        status: 'new',
        result: null,
        createdAt: suggestion.createdAt,
      }],
    }))
  }

  exportData() {
    return { schemaVersion: DATABASE_SCHEMA_VERSION, exportedAt: new Date().toISOString(), conversations: this.db.prepare('SELECT * FROM conversations').all(), workspaces: this.db.prepare('SELECT * FROM workspaces').all(), messages: this.db.prepare('SELECT * FROM messages ORDER BY created_at').all(), artifacts: this.db.prepare('SELECT * FROM artifacts ORDER BY created_at').all(), memories: this.db.prepare('SELECT * FROM workspace_memory').all(), brainMemories: this.db.prepare('SELECT * FROM brain_memories ORDER BY created_at').all(), brainMemoryHistory: this.db.prepare('SELECT * FROM brain_memory_history ORDER BY created_at').all(), suggestions: this.db.prepare('SELECT * FROM suggestions').all(), suggestionDecisions: this.db.prepare('SELECT * FROM suggestion_decisions').all(), providerConfigs: this.db.prepare(`SELECT id,provider_type,display_name,source,base_url,enabled,requires_authentication,timeout_ms,created_at,updated_at FROM provider_configs ORDER BY created_at`).all(), modelCatalog: this.db.prepare('SELECT provider_id,model_id,descriptor,updated_at FROM model_catalog ORDER BY provider_id,model_id').all(), workspaceModelBindings: this.db.prepare('SELECT workspace_id,bindings,updated_at FROM workspace_model_bindings ORDER BY workspace_id').all(), settings: this.getSettings() }
  }

  getExportMetrics() {
    let records = 0
    let contentBytes = 0
    for (const table of exportTables) {
      const columns = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name)
      const byteExpression = columns.map((column) => `COALESCE(LENGTH(CAST("${column}" AS BLOB)),0)`).join('+') || '0'
      const metric = this.db.prepare(`SELECT COUNT(*) records, COALESCE(SUM(${byteExpression}),0) contentBytes FROM ${table}`).get() as { records: number; contentBytes: number }
      records += metric.records
      contentBytes += metric.contentBytes
    }
    return { records, estimatedBytes: contentBytes + records * 64 + 1_024 }
  }

  importData(data: { conversations: unknown[]; workspaces: unknown[]; messages: unknown[]; artifacts: unknown[]; memories: unknown[]; brainMemories?: unknown[]; brainMemoryHistory?: unknown[]; suggestions?: unknown[]; suggestionDecisions?: unknown[]; providerConfigs?: unknown[]; modelCatalog?: unknown[]; workspaceModelBindings?: unknown[]; settings?: Record<string, string> }, scope: 'full' | 'project-data' = 'full') {
    const statements = new Map<string, Database.Statement>()
    const MAX_STRING_LENGTH = 10_000_000
    const insert = (table: string, rows: unknown[]) => {
      const allowed = importColumns[table]
      if (!allowed) throw new Error(`Tabela de importação não permitida: ${table}.`)
      for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as Record<string, unknown>
        const keys = Object.keys(row).filter((key) => allowed.has(key))
        if (!keys.length) continue
        for (const key of keys) {
          const value = row[key]
          if (typeof value === 'string') {
            if (value.length > MAX_STRING_LENGTH || value.includes('\0')) {
              throw new Error(`Valor inválido na coluna ${key} da tabela ${table}.`)
            }
          } else if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new Error(`Valor numérico inválido na coluna ${key} da tabela ${table}.`)
          }
        }
        const signature = `${table}:${keys.join(',')}`
        let statement = statements.get(signature)
        if (!statement) {
          statement = this.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((key) => `@${key}`).join(',')})`)
          statements.set(signature, statement)
        }
        statement.run(row)
      }
    }
    this.db.transaction(() => {
      this.db.exec('DELETE FROM workspace_model_bindings; DELETE FROM brain_memory_history; DELETE FROM brain_memories; DELETE FROM suggestion_decisions; DELETE FROM suggestions; DELETE FROM artifacts; DELETE FROM messages; DELETE FROM conversations; DELETE FROM workspaces; DELETE FROM workspace_memory;')
      if (scope === 'full') this.db.exec('DELETE FROM model_catalog; DELETE FROM provider_configs; DELETE FROM settings;')
      insert('workspaces', data.workspaces.map((row) => ({ ...(row as Record<string, unknown>), authorized: 0 }))); insert('conversations', data.conversations); insert('messages', data.messages); insert('artifacts', data.artifacts); insert('workspace_memory', data.memories); insert('brain_memories', data.brainMemories ?? []); insert('brain_memory_history', data.brainMemoryHistory ?? []); insert('suggestions', data.suggestions ?? []); insert('suggestion_decisions', data.suggestionDecisions ?? [])
      this.db.exec(`INSERT OR IGNORE INTO brain_memory_history(id,memory_id,action,from_status,to_status,summary,created_at)
        SELECT 'created-' || id,id,'created',NULL,status,'Memória restaurada de backup legado.',created_at FROM brain_memories`)
      if (scope === 'full') {
        insert('provider_configs', data.providerConfigs ?? []); insert('model_catalog', data.modelCatalog ?? []); insert('workspace_model_bindings', data.workspaceModelBindings ?? [])
        if (data.settings) this.setSettings(data.settings)
      }
      this.cleanupOrphans()
    })()
  }

  private cleanupOrphans() {
    this.db.exec(`DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations); DELETE FROM artifacts WHERE conversation_id NOT IN (SELECT id FROM conversations); DELETE FROM suggestions WHERE conversation_id NOT IN (SELECT id FROM conversations); DELETE FROM suggestion_decisions WHERE suggestion_id NOT IN (SELECT id FROM suggestions); DELETE FROM brain_memories WHERE workspace_id NOT IN (SELECT path FROM workspaces) OR (conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM conversations)); DELETE FROM workspace_model_bindings WHERE workspace_id NOT IN (SELECT path FROM workspaces);`)
  }

  private addBrainMemoryHistory(memoryId: string, action: BrainMemoryHistoryAction, fromStatus: BrainMemory['status'] | null, toStatus: BrainMemory['status'], summary: string, createdAt: string) {
    this.db.prepare(`INSERT INTO brain_memory_history(id,memory_id,action,from_status,to_status,summary,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), memoryId, action, fromStatus, toStatus, summary, createdAt)
  }

  private runScheduledIntegrityCheck() {
    const key = 'maintenance.lastQuickCheck'
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
    const lastCheck = Date.parse(row?.value ?? '')
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < 7 * 24 * 60 * 60 * 1_000) return
    const integrity = this.db.pragma('quick_check', { simple: true }) as string
    if (integrity !== 'ok') throw new Error(`Banco de dados corrompido (${integrity}). Preserve o arquivo e restaure um backup.`)
    this.db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, new Date().toISOString())
  }

  private createMigrationBackup() {
    const integrity = this.db.pragma('quick_check', { simple: true }) as string
    if (integrity !== 'ok') throw new Error(`O banco atual falhou na verificação de integridade (${integrity}); a migração não foi iniciada.`)
    const checkpoint = this.db.pragma('wal_checkpoint(FULL)') as Array<{ busy: number }>
    if (checkpoint[0]?.busy) throw new Error('O WAL está ocupado; a cópia pré-migração não foi concluída com segurança.')
    const directory = path.dirname(this.databasePath)
    const backupPath = path.join(directory, `${MIGRATION_BACKUP_PREFIX}${Date.now()}.db`)
    const cleanupBackupArtifacts = (removeDatabase: boolean) => {
      const files = removeDatabase ? [backupPath, `${backupPath}-wal`, `${backupPath}-shm`] : [`${backupPath}-wal`, `${backupPath}-shm`]
      for (const filePath of files) {
        try { fs.rmSync(filePath, { force: true }) } catch { /* preserve the original persistence error */ }
      }
    }
    try {
      fs.copyFileSync(this.databasePath, backupPath)
      fs.chmodSync(backupPath, 0o600)
    } catch (error) {
      cleanupBackupArtifacts(true)
      throw error
    }
    let backup: Database.Database | null = null
    try {
      backup = new Database(backupPath, { readonly: true, fileMustExist: true })
      const backupIntegrity = backup.pragma('quick_check', { simple: true }) as string
      if (backupIntegrity !== 'ok') throw new Error(backupIntegrity)
    } catch (error) {
      backup?.close()
      backup = null
      cleanupBackupArtifacts(true)
      throw new Error(`Não foi possível verificar o backup pré-migração: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      backup?.close()
      cleanupBackupArtifacts(false)
    }
    const backups = fs.readdirSync(directory).filter((name) => name.startsWith(MIGRATION_BACKUP_PREFIX) && name.endsWith('.db')).sort().reverse()
    for (const name of backups.slice(MIGRATION_BACKUP_RETENTION)) fs.rmSync(path.join(directory, name), { force: true })
  }

  renameFromPrompt(id: string, prompt: string) {
    const title = prompt.replace(/\s+/g, ' ').trim().slice(0, 52) || 'Nova conversa'
    this.db.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?').run(title, new Date().toISOString(), id)
  }

  setConversationCodexThread(id: string, threadId: string | null) {
    const normalized = threadId?.trim() || null
    if (normalized && normalized.length > 512) throw new Error('Identificador de thread Codex inválido.')
    const changed = this.db.prepare('UPDATE conversations SET codex_thread_id=? WHERE id=?').run(normalized, id)
    if (!changed.changes) throw new Error('Conversa não encontrada.')
  }

  deleteConversation(id: string) { this.db.prepare('DELETE FROM conversations WHERE id=?').run(id) }

  listMessages(conversationId: string): MessageRow[] {
    return this.db.prepare(`SELECT id, conversation_id conversationId, role, content, metadata,
      created_at createdAt FROM messages WHERE conversation_id=? ORDER BY created_at, rowid`).all(conversationId) as MessageRow[]
  }

  listRecentMessages(conversationId: string, limit = 100): MessageRow[] {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const rows = this.db.prepare(`SELECT id, conversation_id conversationId, role, content, metadata, created_at createdAt
      FROM messages WHERE conversation_id=? AND role IN ('user','assistant')
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(conversationId, boundedLimit) as MessageRow[]
    return rows.reverse()
  }

  listMessagePage(conversationId: string, offset = 0, limit = 100) {
    const rows = this.db.prepare(`SELECT id, conversation_id conversationId, role, content, metadata, created_at createdAt
      FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(conversationId, limit + 1, offset) as MessageRow[]
    return { items: rows.slice(0, limit).reverse(), hasMore: rows.length > limit }
  }

  addMessage(conversationId: string, role: MessageRow['role'], content: string, metadata?: unknown) {
    return this.db.transaction(() => this.insertMessage(conversationId, role, content, metadata))()
  }

  private insertMessage(conversationId: string, role: MessageRow['role'], content: string, metadata?: unknown) {
    const serializedMetadata = metadata === undefined || metadata === null ? null : serializeJsonValue(metadata, PERSISTENCE_LIMITS.metadataCharacters)
    const row: MessageRow = { id: randomUUID(), conversationId, role, content, metadata: serializedMetadata, createdAt: new Date().toISOString() }
    this.db.prepare(`INSERT INTO messages (id,conversation_id,role,content,metadata,created_at)
      VALUES (@id,@conversationId,@role,@content,@metadata,@createdAt)`).run(row)
    this.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(row.createdAt, conversationId)
    return row
  }

  close() {
    if (!this.db.open) return
    this.db.pragma('optimize')
    this.db.pragma('wal_checkpoint(PASSIVE)')
    this.db.close()
    this.restrictDatabaseFiles()
  }

  private restrictDatabaseFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      restrictFileIfPresent(`${this.databasePath}${suffix}`)
    }
  }
}

function restrictFileIfPresent(filePath: string) {
  try {
    fs.chmodSync(filePath, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

type EncodedSuggestion = Omit<Suggestion, 'affectedFiles' | 'expectedBenefits' | 'evidence' | 'history'> & {
  affectedFiles: string
  expectedBenefits: string
  evidence: string
}
const suggestionSelect = `SELECT id,workspace_id workspaceId,conversation_id conversationId,title,description,reasoning,category,severity,
  affected_files affectedFiles,proposed_changes proposedChanges,expected_benefits expectedBenefits,complexity,risk,
  evidence,confidence,source,responsible,status,created_at createdAt,updated_at updatedAt FROM suggestions`
function decodeSuggestions(rows: EncodedSuggestion[]) {
  return rows.map((row) => ({
    ...row,
    affectedFiles: JSON.parse(row.affectedFiles) as string[],
    expectedBenefits: JSON.parse(row.expectedBenefits) as string[],
    evidence: JSON.parse(row.evidence) as Suggestion['evidence'],
    history: [],
  }))
}

function isActiveSuggestionStatus(status: SuggestionStatus) {
  return status === 'new' || status === 'in-analysis' || status === 'accepted' || status === 'deferred'
}

function comparisonItem(suggestion: Suggestion): ReviewComparisonItem {
  return {
    id: suggestion.id,
    title: suggestion.title,
    severity: suggestion.severity,
  }
}

const brainMemoryColumns = (prefix = '') => `${prefix}id,${prefix}workspace_id workspaceId,${prefix}conversation_id conversationId,${prefix}kind,${prefix}scope,${prefix}status,${prefix}content,${prefix}confidence,${prefix}source_type sourceType,${prefix}source_id sourceId,${prefix}created_at createdAt,${prefix}updated_at updatedAt,${prefix}last_confirmed_at lastConfirmedAt,${prefix}last_used_at lastUsedAt,${prefix}use_count useCount`
const brainMemorySelect = `SELECT ${brainMemoryColumns()} FROM brain_memories`
const brainMemorySearchSelect = `SELECT ${brainMemoryColumns('memory.')} FROM brain_memories memory JOIN brain_memories_fts ON brain_memories_fts.rowid=memory.rowid`

function brainMemoryStatusAction(from: BrainMemory['status'], to: BrainMemory['status']): BrainMemoryHistoryAction {
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
