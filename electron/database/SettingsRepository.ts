import type Database from 'better-sqlite3'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

export class SettingsRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  get(): Record<string, string> {
    const rows = this.database.prepare("SELECT key,value FROM settings WHERE key NOT LIKE 'maintenance.%'").all() as Array<{ key: string; value: string }>
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    if (settings.approvalPolicy !== 'untrusted') settings.approvalPolicy = 'on-request'
    if (settings.theme !== 'light') settings.theme = 'dark'
    if (settings.language !== 'en') settings.language = 'pt-BR'
    return settings
  }

  set(values: Record<string, string>) {
    const statement = this.database.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    this.transactions.run('settings.set', () => Object.entries(values).forEach(([key, value]) => statement.run(key, value)))
  }
}
