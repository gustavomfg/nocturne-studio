import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import Sqlite from 'better-sqlite3'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../shared/constants'
import { LocalDatabase } from '../electron/database/Database'
import type { Migration } from '../electron/database/migrations'

const BASELINE_COMMIT = 'f793b9cd2e3dd03d1df7ba79da56007400a60e8f'
const BASELINE_TAG = 'v0.9.5-beta'
const TAG_COMMIT = '268c6626dd21b7eae36a150935162333d9adcb6e'
const HISTORICAL_MIGRATIONS_SHA256 = '8c1f02005533440f73b733a374c9d5faab05ae990378866b5a1534f6666e67f5'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function readHistoricalFileAt(commit: string, filePath: string) {
  try {
    return execFileSync('git', ['show', `${commit}:${filePath}`], { encoding: 'utf8' })
  } catch (error) {
    if (commit !== BASELINE_COMMIT) throw error
    const fallbackPath = path.resolve(filePath)
    const fallback = fs.readFileSync(fallbackPath, 'utf8')
    if (filePath === 'electron/database/migrations.ts' && createHash('sha256').update(fallback).digest('hex') === HISTORICAL_MIGRATIONS_SHA256) return fallback
    if (filePath === 'package.json' && (JSON.parse(fallback) as { version?: string }).version === '0.9.5-beta') return fallback
    throw error
  }
}

function gitTagCommit() {
  try {
    return execFileSync('git', ['rev-parse', BASELINE_TAG], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function readHistoricalFile(filePath: string) {
  return readHistoricalFileAt(BASELINE_COMMIT, filePath)
}

function historicalMigrations() {
  const source = readHistoricalFile('electron/database/migrations.ts')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  vm.runInNewContext(output, { module, exports: module.exports })
  return module.exports.migrations as Migration[]
}

function createHistoricalFixture(userDataPath: string) {
  const workspace = path.join(userDataPath, 'fixture-project')
  fs.mkdirSync(workspace)
  const database = new Sqlite(path.join(userDataPath, 'nocturne.db'))
  const migrations = historicalMigrations()
  database.pragma('foreign_keys = ON')
  database.transaction(() => {
    for (const migration of migrations) {
      migration.up(database)
      database.pragma(`user_version = ${migration.version}`)
    }
  })()

  const ids = {
    conversation: '00000000-0000-4000-8000-000000000001',
    message: '00000000-0000-4000-8000-000000000002',
    artifact: '00000000-0000-4000-8000-000000000003',
    suggestion: '00000000-0000-4000-8000-000000000004',
    decision: '00000000-0000-4000-8000-000000000005',
    memory: '00000000-0000-4000-8000-000000000006',
    history: '00000000-0000-4000-8000-000000000007',
    provider: '00000000-0000-4000-8000-000000000008',
    credentialReference: '00000000-0000-4000-8000-000000000009',
  }
  const timestamp = '2026-07-31T16:00:00.000Z'
  database.prepare(`INSERT INTO workspaces(path,name,favorite,authorized,created_at,last_opened_at)
    VALUES(?,?,?,?,?,?)`).run(workspace, 'Fixture project', 1, 1, timestamp, timestamp)
  database.prepare(`INSERT INTO conversations(id,title,workspace,codex_thread_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?)`).run(ids.conversation, 'Conversa histórica', workspace, 'thread-0-9-5', timestamp, timestamp)
  database.prepare(`INSERT INTO messages(id,conversation_id,role,content,metadata,created_at)
    VALUES(?,?,?,?,?,?)`).run(ids.message, ids.conversation, 'assistant', 'Resposta preservada', '{"source":"fixture"}', timestamp)
  database.prepare(`INSERT INTO artifacts(id,conversation_id,workspace,type,title,file_path,content,metadata,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(ids.artifact, ids.conversation, workspace, 'markdown', 'Documento preservado', 'docs/fixture.md', '# Conteúdo histórico', '{}', timestamp, timestamp)
  database.prepare(`INSERT INTO workspace_memory(workspace,content,updated_at) VALUES(?,?,?)`)
    .run(workspace, 'Memória histórica do workspace.', timestamp)
  database.prepare(`INSERT INTO suggestions(id,workspace_id,conversation_id,title,description,reasoning,category,severity,affected_files,proposed_changes,expected_benefits,complexity,risk,evidence,confidence,source,responsible,status,result,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ids.suggestion, workspace, ids.conversation, 'Sugestão histórica', 'Descrição preservada', 'Justificativa preservada', 'testing', 'medium',
    '["src/app.ts"]', 'Alteração proposta', '["Benefício preservado"]', 'medium', 'low', '[{"source":"fixture","detail":"Evidência preservada"}]', 85,
    'Revisão 0.9.5', 'Equipe', 'deferred', null, timestamp, timestamp,
  )
  database.prepare(`INSERT INTO suggestion_decisions(id,suggestion_id,status,result,created_at) VALUES(?,?,?,?,?)`)
    .run(ids.decision, ids.suggestion, 'deferred', 'Adiada pelo usuário', timestamp)
  database.prepare(`INSERT INTO brain_memories(id,workspace_id,conversation_id,kind,scope,status,content,confidence,source_type,source_id,created_at,updated_at,last_confirmed_at,last_used_at,use_count)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ids.memory, workspace, null, 'decision', 'workspace', 'active', 'Decisão histórica preservada.', 90, 'manual', null, timestamp, timestamp, timestamp, null, 0,
  )
  database.prepare(`INSERT INTO brain_memory_history(id,memory_id,action,from_status,to_status,summary,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(ids.history, ids.memory, 'created', null, 'active', 'Histórico preservado.', timestamp)
  database.prepare(`INSERT INTO provider_configs(id,provider_type,display_name,source,base_url,enabled,requires_authentication,credential_ref,timeout_ms,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(ids.provider, 'openai-compatible', 'Provider histórico', 'remote', 'https://example.invalid/v1', 1, 1, ids.credentialReference, 30_000, timestamp, timestamp)
  const descriptor = JSON.stringify({ providerId: ids.provider, modelId: 'historical-model', displayName: 'Historical Model', source: 'remote', capabilities: ['chat'], availability: 'missing-credentials' })
  database.prepare(`INSERT INTO model_catalog(provider_id,model_id,descriptor,updated_at) VALUES(?,?,?,?)`)
    .run(ids.provider, 'historical-model', descriptor, timestamp)
  database.prepare(`INSERT INTO workspace_model_bindings(workspace_id,bindings,updated_at) VALUES(?,?,?)`)
    .run(workspace, JSON.stringify({ workspaceId: workspace, defaultBinding: { providerId: ids.provider, modelId: 'historical-model' } }), timestamp)
  database.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('approvalPolicy', 'on-request')
  database.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('fixtureSetting', 'preserved')
  database.close()
  return { workspace, ids, timestamp }
}

describe('ensaio histórico de migração 0.9.5-beta', () => {
  it('gera o fixture a partir das migrations históricas e preserva dados no startup atual', () => {
    const tagCommit = gitTagCommit()
    if (tagCommit) {
      expect(tagCommit).toBe(TAG_COMMIT)
      expect((JSON.parse(readHistoricalFileAt(TAG_COMMIT, 'package.json')) as { version: string }).version).toBe('0.9.0-beta')
    }
    const packageMetadata = JSON.parse(readHistoricalFile('package.json')) as { version: string }
    expect(packageMetadata.version).toBe('0.9.5-beta')

    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-migration-rehearsal-'))
    directories.push(userDataPath)
    const fixture = createHistoricalFixture(userDataPath)

    const migrated = new LocalDatabase(userDataPath)
    const firstExport = migrated.exportData()
    expect(firstExport.schemaVersion).toBe(DATABASE_SCHEMA_VERSION)
    expect(migrated.listWorkspaces()).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: fixture.workspace, name: 'Fixture project', favorite: true, authorized: true }),
    ]))
    expect(migrated.listConversations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.ids.conversation, title: 'Conversa histórica', codexThreadId: 'thread-0-9-5' }),
    ]))
    expect(migrated.listMessages(fixture.ids.conversation)).toEqual([
      expect.objectContaining({ id: fixture.ids.message, content: 'Resposta preservada' }),
    ])
    expect(migrated.listArtifacts(fixture.ids.conversation)).toEqual([
      expect.objectContaining({ id: fixture.ids.artifact, filePath: 'docs/fixture.md', content: '# Conteúdo histórico' }),
    ])
    expect(migrated.getWorkspaceMemory(fixture.workspace).content).toBe('Memória histórica do workspace.')
    expect(migrated.getSuggestion(fixture.ids.suggestion, fixture.ids.conversation)).toEqual(expect.objectContaining({ status: 'deferred', title: 'Sugestão histórica' }))
    expect(migrated.getSuggestion(fixture.ids.suggestion, fixture.ids.conversation)?.history).toEqual([
      expect.objectContaining({ id: fixture.ids.decision, status: 'deferred', result: 'Adiada pelo usuário' }),
    ])
    expect(migrated.getBrainMemory(fixture.ids.memory, fixture.workspace)).toEqual(expect.objectContaining({ content: 'Decisão histórica preservada.', status: 'active' }))
    expect(migrated.listBrainMemoryHistory(fixture.ids.memory, fixture.workspace)).toEqual([
      expect.objectContaining({ id: fixture.ids.history, summary: 'Histórico preservado.' }),
    ])
    expect(migrated.providerConfigurations.getCredentialReference(fixture.ids.provider)).toBe(fixture.ids.credentialReference)
    expect(migrated.modelCatalog.list()).toEqual([
      expect.objectContaining({ providerId: fixture.ids.provider, modelId: 'historical-model', availability: 'missing-credentials' }),
    ])
    expect(migrated.workspaceModelBindings.get(fixture.workspace)).toEqual({
      workspaceId: fixture.workspace,
      defaultBinding: { providerId: fixture.ids.provider, modelId: 'historical-model' },
    })
    expect(migrated.getSettings().fixtureSetting).toBe('preserved')
    migrated.close()

    const databaseAfterFirstStartup = new Sqlite(path.join(userDataPath, 'nocturne.db'), { readonly: true })
    expect(databaseAfterFirstStartup.pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
    expect(databaseAfterFirstStartup.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toEqual({ count: 1 })
    expect(databaseAfterFirstStartup.prepare('SELECT COUNT(*) AS count FROM suggestions').get()).toEqual({ count: 1 })
    databaseAfterFirstStartup.close()

    const reopened = new LocalDatabase(userDataPath)
    expect(reopened.exportData().conversations).toHaveLength(firstExport.conversations.length)
    expect(reopened.exportData().suggestions).toHaveLength(firstExport.suggestions.length)
    expect(reopened.getWorkspaceMemory(fixture.workspace).content).toBe('Memória histórica do workspace.')
    reopened.close()
  })
})
