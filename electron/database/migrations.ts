import type Database from 'better-sqlite3'

export interface Migration { version: number; up(db: Database.Database): void }

const hasColumn = (db: Database.Database, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column)

export const migrations: Migration[] = [
  { version: 1, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace TEXT NOT NULL, codex_thread_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `) },
  { version: 2, up: (db) => {
    db.exec('CREATE TABLE IF NOT EXISTS workspaces (path TEXT PRIMARY KEY, name TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_opened_at TEXT NOT NULL);')
    if (!hasColumn(db, 'workspaces', 'favorite')) db.exec('ALTER TABLE workspaces ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0')
    db.exec('INSERT OR IGNORE INTO workspaces(path,name,created_at,last_opened_at) SELECT workspace, workspace, MIN(created_at), MAX(updated_at) FROM conversations GROUP BY workspace;')
  } },
  { version: 3, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_memory (workspace TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, workspace TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT, content TEXT, metadata TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id, updated_at);
    CREATE TABLE IF NOT EXISTS approval_audit (id TEXT PRIMARY KEY, approval_key TEXT NOT NULL, decision TEXT NOT NULL, command TEXT, risk TEXT, created_at TEXT NOT NULL);
  `) },
  { version: 4, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, reasoning TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL, affected_files TEXT NOT NULL, proposed_changes TEXT NOT NULL, expected_benefits TEXT NOT NULL DEFAULT '[]', complexity TEXT NOT NULL DEFAULT 'medium', risk TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_suggestions_conversation ON suggestions(conversation_id, updated_at);
    CREATE TABLE IF NOT EXISTS suggestion_decisions (id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, FOREIGN KEY (suggestion_id) REFERENCES suggestions(id) ON DELETE CASCADE);
  `) },
  { version: 5, up: (db) => {
    if (!hasColumn(db, 'suggestions', 'expected_benefits')) db.exec("ALTER TABLE suggestions ADD COLUMN expected_benefits TEXT NOT NULL DEFAULT '[]'")
    if (!hasColumn(db, 'suggestions', 'complexity')) db.exec("ALTER TABLE suggestions ADD COLUMN complexity TEXT NOT NULL DEFAULT 'medium'")
    if (!hasColumn(db, 'suggestions', 'risk')) db.exec("ALTER TABLE suggestions ADD COLUMN risk TEXT NOT NULL DEFAULT 'medium'")
  } },
  { version: 6, up: (db) => {
    if (!hasColumn(db, 'workspaces', 'authorized')) db.exec('ALTER TABLE workspaces ADD COLUMN authorized INTEGER NOT NULL DEFAULT 1')
  } },
  { version: 7, up: (db) => db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspaces_recent ON workspaces(favorite DESC, last_opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_file ON artifacts(conversation_id, file_path, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_suggestion_decisions_suggestion ON suggestion_decisions(suggestion_id, created_at);
  `) },
  { version: 8, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS brain_memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      conversation_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('fact','decision','preference','constraint','learning')),
      scope TEXT NOT NULL CHECK(scope IN ('workspace','conversation')),
      status TEXT NOT NULL CHECK(status IN ('candidate','active','outdated','archived')),
      content TEXT NOT NULL,
      confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
      source_type TEXT NOT NULL CHECK(source_type IN ('manual','message','agent')),
      source_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_confirmed_at TEXT,
      last_used_at TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(path) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CHECK((scope = 'workspace' AND conversation_id IS NULL) OR (scope = 'conversation' AND conversation_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_brain_memories_workspace ON brain_memories(workspace_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_brain_memories_conversation ON brain_memories(conversation_id, status, updated_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS brain_memories_fts USING fts5(content, content='brain_memories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS brain_memories_ai AFTER INSERT ON brain_memories BEGIN
      INSERT INTO brain_memories_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS brain_memories_ad AFTER DELETE ON brain_memories BEGIN
      INSERT INTO brain_memories_fts(brain_memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS brain_memories_au AFTER UPDATE OF content ON brain_memories BEGIN
      INSERT INTO brain_memories_fts(brain_memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO brain_memories_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    INSERT INTO brain_memories_fts(brain_memories_fts) VALUES ('rebuild');
  `) },
  { version: 9, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 500),
      source TEXT NOT NULL CHECK(source IN ('local','remote')),
      base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      requires_authentication INTEGER NOT NULL CHECK(requires_authentication IN (0,1)),
      credential_ref TEXT UNIQUE,
      timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 120000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(credential_ref IS NULL OR length(credential_ref) = 36)
    );
    CREATE INDEX IF NOT EXISTS idx_provider_configs_enabled
      ON provider_configs(enabled DESC, updated_at DESC);
  `) },
  { version: 10, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS model_catalog (
      provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 512),
      model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 512),
      descriptor TEXT NOT NULL CHECK(length(descriptor) BETWEEN 2 AND 100000),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(provider_id, model_id)
    );
    CREATE INDEX IF NOT EXISTS idx_model_catalog_provider
      ON model_catalog(provider_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS workspace_model_bindings (
      workspace_id TEXT PRIMARY KEY,
      bindings TEXT NOT NULL CHECK(length(bindings) BETWEEN 2 AND 50000),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(path) ON DELETE CASCADE
    );
  `) },
  { version: 11, up: (db) => {
    if (hasColumn(db, 'conversations', 'codex_thread_id'))
      db.exec('ALTER TABLE conversations DROP COLUMN codex_thread_id;')
  } },
  { version: 12, up: (db) => {
    if (!hasColumn(db, 'conversations', 'codex_thread_id')) {
      db.exec('ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT CHECK(codex_thread_id IS NULL OR length(codex_thread_id) BETWEEN 1 AND 512)')
    }
  } },
  { version: 13, up: (db) => {
    if (!hasColumn(db, 'suggestions', 'evidence')) db.exec("ALTER TABLE suggestions ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]'")
    if (!hasColumn(db, 'suggestions', 'confidence')) db.exec('ALTER TABLE suggestions ADD COLUMN confidence INTEGER NOT NULL DEFAULT 60 CHECK(confidence BETWEEN 0 AND 100)')
    if (!hasColumn(db, 'suggestions', 'source')) db.exec("ALTER TABLE suggestions ADD COLUMN source TEXT NOT NULL DEFAULT 'Análise do agente'")
    if (!hasColumn(db, 'suggestions', 'responsible')) db.exec("ALTER TABLE suggestions ADD COLUMN responsible TEXT NOT NULL DEFAULT 'Agente de revisão'")
  } },
  { version: 14, up: (db) => {
    db.exec(`
      UPDATE suggestions SET status='new' WHERE status='pending';
      UPDATE suggestions SET status='resolved' WHERE status='applied';
      UPDATE suggestion_decisions SET status='new' WHERE status='pending';
      UPDATE suggestion_decisions SET status='resolved' WHERE status='applied';
    `)
  } },
  { version: 15, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS brain_memory_history (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','edited','approved','disapproved','marked-outdated','archived','restored')),
      from_status TEXT CHECK(from_status IS NULL OR from_status IN ('candidate','active','outdated','archived')),
      to_status TEXT NOT NULL CHECK(to_status IN ('candidate','active','outdated','archived')),
      summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES brain_memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_brain_memory_history_memory
      ON brain_memory_history(memory_id, created_at DESC);
    INSERT OR IGNORE INTO brain_memory_history(id,memory_id,action,from_status,to_status,summary,created_at)
      SELECT 'created-' || id,id,'created',NULL,status,'Memória existente incorporada ao histórico.',created_at
      FROM brain_memories;
  `) },
  { version: 16, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS project_index_runs (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      index_version INTEGER NOT NULL CHECK(index_version >= 1),
      kind TEXT NOT NULL CHECK(kind IN ('initial','incremental','reconcile','retry','manual')),
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','cancelled','failed')),
      phase TEXT NOT NULL CHECK(phase IN ('discovering','hashing','parsing','persisting','completed','cancelled')),
      total_files INTEGER NOT NULL DEFAULT 0 CHECK(total_files >= 0),
      processed_files INTEGER NOT NULL DEFAULT 0 CHECK(processed_files >= 0),
      failed_files INTEGER NOT NULL DEFAULT 0 CHECK(failed_files >= 0),
      unsupported_files INTEGER NOT NULL DEFAULT 0 CHECK(unsupported_files >= 0),
      pending_files INTEGER NOT NULL DEFAULT 0 CHECK(pending_files >= 0),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_runs_workspace
      ON project_index_runs(workspace, updated_at DESC);

    CREATE TABLE IF NOT EXISTS project_index_files (
      workspace TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      classification TEXT NOT NULL CHECK(classification IN ('source','configuration','documentation','lockfile','asset','unknown')),
      language TEXT NOT NULL,
      extension TEXT NOT NULL,
      size INTEGER NOT NULL CHECK(size >= 0),
      mtime_ms REAL NOT NULL CHECK(mtime_ms >= 0),
      ctime_ms REAL NOT NULL CHECK(ctime_ms >= 0),
      mode INTEGER NOT NULL CHECK(mode >= 0),
      observed_hash TEXT CHECK(observed_hash IS NULL OR length(observed_hash) = 64),
      analyzed_hash TEXT CHECK(analyzed_hash IS NULL OR length(analyzed_hash) = 64),
      state TEXT NOT NULL CHECK(state IN ('discovered','pending','processing','indexed','unsupported','failed','deleted','excluded')),
      excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
      exclusion_reason TEXT,
      parser_id TEXT,
      parser_version TEXT,
      error TEXT,
      discovered_at TEXT NOT NULL,
      analyzed_at TEXT,
      PRIMARY KEY(workspace, relative_path),
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_files_state
      ON project_index_files(workspace, state, relative_path);
    CREATE INDEX IF NOT EXISTS idx_project_index_files_language
      ON project_index_files(workspace, language, relative_path);

    CREATE TABLE IF NOT EXISTS project_index_symbols (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      analyzed_hash TEXT NOT NULL CHECK(length(analyzed_hash) = 64),
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT,
      scope TEXT,
      signature TEXT,
      start_line INTEGER NOT NULL CHECK(start_line >= 1),
      start_column INTEGER NOT NULL CHECK(start_column >= 1),
      end_line INTEGER NOT NULL CHECK(end_line >= start_line),
      end_column INTEGER NOT NULL CHECK(end_column >= 1),
      exported INTEGER NOT NULL DEFAULT 0 CHECK(exported IN (0,1)),
      parser_id TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      FOREIGN KEY (workspace, relative_path) REFERENCES project_index_files(workspace, relative_path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_symbols_file
      ON project_index_symbols(workspace, relative_path, start_line);
    CREATE INDEX IF NOT EXISTS idx_project_index_symbols_name
      ON project_index_symbols(workspace, name);

    CREATE TABLE IF NOT EXISTS project_index_imports (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
      specifier TEXT NOT NULL,
      target_path TEXT,
      target_hash TEXT CHECK(target_hash IS NULL OR length(target_hash) = 64),
      kind TEXT NOT NULL,
      imported_names TEXT NOT NULL,
      start_line INTEGER NOT NULL CHECK(start_line >= 1),
      start_column INTEGER NOT NULL CHECK(start_column >= 1),
      end_line INTEGER NOT NULL CHECK(end_line >= start_line),
      end_column INTEGER NOT NULL CHECK(end_column >= 1),
      resolution TEXT NOT NULL CHECK(resolution IN ('local','external','unresolved')),
      FOREIGN KEY (workspace, source_path) REFERENCES project_index_files(workspace, relative_path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_imports_source
      ON project_index_imports(workspace, source_path, start_line);
    CREATE INDEX IF NOT EXISTS idx_project_index_imports_target
      ON project_index_imports(workspace, target_path);

    CREATE TABLE IF NOT EXISTS project_index_exports (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_path TEXT,
      target_hash TEXT CHECK(target_hash IS NULL OR length(target_hash) = 64),
      start_line INTEGER NOT NULL CHECK(start_line >= 1),
      start_column INTEGER NOT NULL CHECK(start_column >= 1),
      end_line INTEGER NOT NULL CHECK(end_line >= start_line),
      end_column INTEGER NOT NULL CHECK(end_column >= 1),
      FOREIGN KEY (workspace, source_path) REFERENCES project_index_files(workspace, relative_path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_exports_source
      ON project_index_exports(workspace, source_path, start_line);

    CREATE TABLE IF NOT EXISTS project_stack_evidence (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
      source_path TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
      source_line INTEGER,
      reason TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      UNIQUE(workspace, category, value, source_path, source_hash, reason),
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_stack_evidence_workspace
      ON project_stack_evidence(workspace, category, value);

    CREATE TABLE IF NOT EXISTS project_index_exclusions (
      workspace TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      PRIMARY KEY(workspace, relative_path),
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_exclusions_workspace
      ON project_index_exclusions(workspace, relative_path);
  `) },
  { version: 17, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS validation_runs (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('typecheck','lint','test','build','smoke')),
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed','cancelled','blocked')),
      exit_code INTEGER,
      duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
      output_summary TEXT NOT NULL,
      artifacts_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_validation_runs_workspace
      ON validation_runs(workspace, started_at DESC);
  `) },
  { version: 18, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('build','review','docs')),
      status TEXT NOT NULL CHECK(status IN ('created','planning','running','awaiting-review','validating','completed','failed','cancelled')),
      decision TEXT NOT NULL CHECK(decision IN ('pending','accepted','partially-accepted','rejected','reverted','conflicted')),
      retry_of TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT,
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (retry_of) REFERENCES executions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_executions_workspace_started
      ON executions(workspace, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_executions_conversation_started
      ON executions(conversation_id, started_at DESC);
  `) },
  { version: 19, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      workspace TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('before','after')),
      status TEXT NOT NULL CHECK(status IN ('capturing','ready','failed')),
      captured_at TEXT NOT NULL,
      root_path TEXT NOT NULL,
      error TEXT,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace) REFERENCES workspaces(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_execution_phase
      ON checkpoints(execution_id, phase, captured_at DESC);
    CREATE TABLE IF NOT EXISTS checkpoint_files (
      id TEXT PRIMARY KEY,
      checkpoint_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      exists_flag INTEGER NOT NULL CHECK(exists_flag IN (0,1)),
      kind TEXT NOT NULL CHECK(kind IN ('file','directory','symlink','missing')),
      size INTEGER,
      mode INTEGER,
      hash TEXT,
      content_path TEXT,
      UNIQUE(checkpoint_id, relative_path),
      FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoint_files_checkpoint
      ON checkpoint_files(checkpoint_id, relative_path);
  `) },
  { version: 20, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS change_sets (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      before_checkpoint_id TEXT NOT NULL,
      after_checkpoint_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','partially-accepted','rejected','conflicted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
      FOREIGN KEY (before_checkpoint_id) REFERENCES checkpoints(id) ON DELETE RESTRICT,
      FOREIGN KEY (after_checkpoint_id) REFERENCES checkpoints(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_change_sets_execution_updated
      ON change_sets(execution_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      checkpoint_id TEXT,
      relative_path TEXT NOT NULL,
      original_path TEXT,
      operation TEXT NOT NULL CHECK(operation IN ('create','modify','delete','rename')),
      origin TEXT NOT NULL CHECK(origin IN ('codex-file-change','codex-command','validation','documents','manual')),
      before_hash TEXT,
      after_hash TEXT,
      before_size INTEGER,
      after_size INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','edited','conflicted')),
      validation_status TEXT NOT NULL CHECK(validation_status IN ('unknown','pending','passed','failed','blocked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (change_set_id) REFERENCES change_sets(id) ON DELETE CASCADE,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
      FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_changes_change_set_path
      ON changes(change_set_id, relative_path);
    CREATE INDEX IF NOT EXISTS idx_changes_execution_updated
      ON changes(execution_id, updated_at DESC);
  `) },
  { version: 21, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS execution_commands (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('agent','validation','system')),
      status TEXT NOT NULL CHECK(status IN ('running','passed','failed','cancelled')),
      exit_code INTEGER,
      duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
      output_summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_execution_commands_execution
      ON execution_commands(execution_id, started_at);
    CREATE TABLE IF NOT EXISTS execution_errors (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('planning','mutation','validation','decision','rollback','persistence')),
      message TEXT NOT NULL,
      path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_execution_errors_execution
      ON execution_errors(execution_id, created_at);
    CREATE TABLE IF NOT EXISTS execution_validation_links (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      change_id TEXT,
      validation_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('before','proposed','after-decision')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
      FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE,
      FOREIGN KEY (validation_id) REFERENCES validation_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_execution_validation_links_execution
      ON execution_validation_links(execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_execution_validation_links_change
      ON execution_validation_links(change_id, created_at);
  `) },
  { version: 22, up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS change_hunks (
      id TEXT PRIMARY KEY,
      change_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK(sequence >= 1),
      base_hash TEXT NOT NULL CHECK(length(base_hash) = 64),
      original_patch TEXT NOT NULL,
      final_patch TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','edited','conflicted')),
      start_line INTEGER NOT NULL CHECK(start_line >= 1),
      end_line INTEGER NOT NULL CHECK(end_line >= start_line),
      decision_at TEXT,
      UNIQUE(change_id, sequence),
      FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_change_hunks_change
      ON change_hunks(change_id, sequence);
  `) },
  { version: 23, up: (db) => {
    if (!hasColumn(db, 'changes', 'policy')) db.exec("ALTER TABLE changes ADD COLUMN policy TEXT NOT NULL DEFAULT 'allowed' CHECK(policy IN ('allowed','requires-approval','blocked'))")
    if (!hasColumn(db, 'changes', 'policy_reason')) db.exec('ALTER TABLE changes ADD COLUMN policy_reason TEXT')
  } },
  { version: 24, up: (db) => {
    if (!hasColumn(db, 'validation_runs', 'execution_id')) db.exec('ALTER TABLE validation_runs ADD COLUMN execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL')
    db.exec('CREATE INDEX IF NOT EXISTS idx_validation_runs_execution ON validation_runs(execution_id, started_at DESC)')
  } },
]

export function migrateDatabase(db: Database.Database, currentVersion: number, availableMigrations: Migration[] = migrations) {
  db.transaction(() => {
    // Builds antigos podiam marcar v1 após criar apenas conversations. A etapa
    // inicial é idempotente e também repara esse snapshot legado incompleto.
    if (currentVersion > 0) migrations[0].up(db)
    for (const migration of availableMigrations) {
      if (migration.version <= currentVersion) continue
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    }
  })()
}
