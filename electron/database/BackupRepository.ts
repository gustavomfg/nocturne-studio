import type Database from 'better-sqlite3'
import { DATABASE_SCHEMA_VERSION } from '../../shared/constants'
import { SettingsRepository } from './SettingsRepository'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

export interface DatabaseImportData {
  conversations: unknown[]
  workspaces: unknown[]
  messages: unknown[]
  artifacts: unknown[]
  memories: unknown[]
  brainMemories?: unknown[]
  brainMemoryHistory?: unknown[]
  suggestions?: unknown[]
  suggestionDecisions?: unknown[]
  providerConfigs?: unknown[]
  modelCatalog?: unknown[]
  workspaceModelBindings?: unknown[]
  settings?: Record<string, string>
}

type ImportScope = 'full' | 'project-data'

/** Owns the database-shaped backup contract and transactional restoration. */
export class BackupRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly settings: SettingsRepository,
    private readonly cleanupOrphans: () => void,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  exportData() {
    return {
      schemaVersion: DATABASE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      conversations: this.database.prepare('SELECT * FROM conversations').all(),
      workspaces: this.database.prepare('SELECT * FROM workspaces').all(),
      messages: this.database.prepare('SELECT * FROM messages ORDER BY created_at').all(),
      artifacts: this.database.prepare('SELECT * FROM artifacts ORDER BY created_at').all(),
      memories: this.database.prepare('SELECT * FROM workspace_memory').all(),
      brainMemories: this.database.prepare('SELECT * FROM brain_memories ORDER BY created_at').all(),
      brainMemoryHistory: this.database.prepare('SELECT * FROM brain_memory_history ORDER BY created_at').all(),
      suggestions: this.database.prepare('SELECT * FROM suggestions').all(),
      suggestionDecisions: this.database.prepare('SELECT * FROM suggestion_decisions').all(),
      providerConfigs: this.database.prepare(`SELECT id,provider_type,display_name,source,
        base_url,enabled,requires_authentication,timeout_ms,created_at,updated_at
        FROM provider_configs ORDER BY created_at`).all(),
      modelCatalog: this.database.prepare(`SELECT provider_id,model_id,descriptor,updated_at
        FROM model_catalog ORDER BY provider_id,model_id`).all(),
      workspaceModelBindings: this.database.prepare(`SELECT workspace_id,bindings,updated_at
        FROM workspace_model_bindings ORDER BY workspace_id`).all(),
      settings: this.settings.get(),
    }
  }

  getExportMetrics() {
    let records = 0
    let contentBytes = 0
    for (const table of exportTables) {
      const columns = (this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map(({ name }) => name)
      const byteExpression = columns
        .map((column) => `COALESCE(LENGTH(CAST("${column}" AS BLOB)),0)`)
        .join('+') || '0'
      const metric = this.database.prepare(`SELECT COUNT(*) records,
        COALESCE(SUM(${byteExpression}),0) contentBytes FROM ${table}`).get() as {
        records: number
        contentBytes: number
      }
      records += metric.records
      contentBytes += metric.contentBytes
    }
    return { records, estimatedBytes: contentBytes + records * 64 + 1_024 }
  }

  importData(data: DatabaseImportData, scope: ImportScope = 'full') {
    const statements = new Map<string, Database.Statement>()
    const maxStringLength = 10_000_000
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
            if (value.length > maxStringLength || value.includes('\0')) {
              throw new Error(`Valor inválido na coluna ${key} da tabela ${table}.`)
            }
          } else if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new Error(`Valor numérico inválido na coluna ${key} da tabela ${table}.`)
          }
        }
        const signature = `${table}:${keys.join(',')}`
        let statement = statements.get(signature)
        if (!statement) {
          statement = this.database.prepare(`INSERT INTO ${table} (${keys.join(',')})
            VALUES (${keys.map((key) => `@${key}`).join(',')})`)
          statements.set(signature, statement)
        }
        statement.run(row)
      }
    }

    this.transactions.run('backup.importData', () => {
      this.database.exec(`DELETE FROM workspace_model_bindings;
        DELETE FROM brain_memory_history;
        DELETE FROM brain_memories;
        DELETE FROM suggestion_decisions;
        DELETE FROM suggestions;
        DELETE FROM artifacts;
        DELETE FROM messages;
        DELETE FROM conversations;
        DELETE FROM workspaces;
        DELETE FROM workspace_memory;`)
      if (scope === 'full') {
        this.database.exec('DELETE FROM model_catalog; DELETE FROM provider_configs; DELETE FROM settings;')
      }
      insert('workspaces', data.workspaces.map((row) => ({
        ...(row as Record<string, unknown>),
        authorized: 0,
      })))
      insert('conversations', data.conversations)
      insert('messages', data.messages)
      insert('artifacts', data.artifacts)
      insert('workspace_memory', data.memories)
      insert('brain_memories', data.brainMemories ?? [])
      insert('brain_memory_history', data.brainMemoryHistory ?? [])
      insert('suggestions', data.suggestions ?? [])
      insert('suggestion_decisions', data.suggestionDecisions ?? [])
      this.database.exec(`INSERT OR IGNORE INTO brain_memory_history(
        id,memory_id,action,from_status,to_status,summary,created_at
      ) SELECT 'created-' || id,id,'created',NULL,status,
        'Memória restaurada de backup legado.',created_at FROM brain_memories`)
      if (scope === 'full') {
        insert('provider_configs', data.providerConfigs ?? [])
        insert('model_catalog', data.modelCatalog ?? [])
        insert('workspace_model_bindings', data.workspaceModelBindings ?? [])
        if (data.settings) this.settings.set(data.settings)
      }
      this.cleanupOrphans()
    })
  }
}

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

const exportTables = [
  'conversations',
  'workspaces',
  'messages',
  'artifacts',
  'workspace_memory',
  'brain_memories',
  'brain_memory_history',
  'suggestions',
  'suggestion_decisions',
  'provider_configs',
  'model_catalog',
  'workspace_model_bindings',
  'settings',
] as const
