import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { DATABASE_SCHEMA_VERSION } from '../../shared/constants'
import { migrateDatabase } from './migrations'

const MIGRATION_BACKUP_PREFIX = 'nocturne.db.backup-'
const MIGRATION_BACKUP_RETENTION = 3

export interface DatabaseOperationMetric {
  operation: string
  durationMs: number
  failed: boolean
}

export type DatabaseOperationObserver = (metric: DatabaseOperationMetric) => void

/** Owns the SQLite connection and its startup/shutdown invariants. */
export class DatabaseRuntime {
  readonly databasePath: string
  readonly db: Database.Database
  private operationObserver: DatabaseOperationObserver | undefined

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
    this.runScheduledIntegrityCheck()
    this.cleanupOrphans()
  }

  runInTransaction<T>(operation: () => T): T {
    return this.measure('transaction', () => this.db.transaction(operation)())
  }

  setOperationObserver(observer: DatabaseOperationObserver | undefined) {
    this.operationObserver = observer
  }

  measure<T>(operation: string, callback: () => T): T {
    const startedAt = performance.now()
    let failed = false
    try {
      return callback()
    } catch (error) {
      failed = true
      throw error
    } finally {
      try {
        this.operationObserver?.({
          operation,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          failed,
        })
      } catch {
        // Observability must never change persistence behavior.
      }
    }
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

  close() {
    if (!this.db.open) return
    this.db.pragma('optimize')
    this.db.pragma('wal_checkpoint(PASSIVE)')
    this.db.close()
    this.restrictDatabaseFiles()
  }

  private restrictDatabaseFiles() {
    for (const suffix of ['', '-wal', '-shm']) restrictFileIfPresent(`${this.databasePath}${suffix}`)
  }

  cleanupOrphans() {
    this.db.exec(`DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations); DELETE FROM artifacts WHERE conversation_id NOT IN (SELECT id FROM conversations); DELETE FROM suggestions WHERE conversation_id NOT IN (SELECT id FROM conversations); DELETE FROM suggestion_decisions WHERE suggestion_id NOT IN (SELECT id FROM suggestions); DELETE FROM brain_memories WHERE workspace_id NOT IN (SELECT path FROM workspaces) OR (conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM conversations)); DELETE FROM workspace_model_bindings WHERE workspace_id NOT IN (SELECT path FROM workspaces);`)
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
}

function restrictFileIfPresent(filePath: string) {
  try {
    fs.chmodSync(filePath, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
