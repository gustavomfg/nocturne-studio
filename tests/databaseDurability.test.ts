import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { restoreDatabaseFile } from '../electron/database/recovery'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

describe('durabilidade SQLite e restauração', () => {
  it('mantém a configuração WAL e synchronous=FULL no banco do produto', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-pragmas-'))
    directories.push(root)
    const database = new LocalDatabase(root)
    const connection = (database as unknown as { db: Sqlite.Database }).db

    expect(connection.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(connection.pragma('synchronous', { simple: true })).toBe(2)
    expect(connection.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(connection.pragma('busy_timeout', { simple: true })).toBe(5_000)
    expect(connection.pragma('temp_store', { simple: true })).toBe(2)
    database.close()
  })

  it('não expõe dados de uma transação interrompida após reabertura', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-rollback-'))
    directories.push(root)
    const filePath = path.join(root, 'state.db')
    const database = new Sqlite(filePath)
    database.exec('PRAGMA journal_mode = WAL; CREATE TABLE state (value TEXT NOT NULL);')
    const transaction = database.transaction(() => {
      database.prepare('INSERT INTO state(value) VALUES (?)').run('não confirmado')
      throw new Error('interrupção determinística')
    })

    expect(() => transaction()).toThrow('interrupção determinística')
    expect(database.prepare('SELECT COUNT(*) AS count FROM state').get()).toEqual({ count: 0 })
    database.close()

    const reopened = new Sqlite(filePath, { readonly: true })
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM state').get()).toEqual({ count: 0 })
    reopened.close()
  })

  it('preserva uma transação confirmada depois de fechar e reabrir o WAL', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-commit-'))
    directories.push(root)
    const filePath = path.join(root, 'state.db')
    const database = new Sqlite(filePath)
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; CREATE TABLE state (value TEXT NOT NULL);')
    database.transaction(() => {
      database.prepare('INSERT INTO state(value) VALUES (?)').run('confirmado')
    })()
    database.close()

    const reopened = new Sqlite(filePath, { readonly: true })
    expect(reopened.prepare('SELECT value FROM state').get()).toEqual({ value: 'confirmado' })
    reopened.close()
  })

  it('faz backup e restore round-trip preservando o estado semântico anterior', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-roundtrip-'))
    directories.push(root)
    const database = new LocalDatabase(root)
    const conversation = database.createConversation('/tmp/roundtrip-project')
    database.addMessage(conversation.id, 'assistant', 'estado antes do restore')
    const snapshot = await database.createRecoverySnapshot()
    database.addMessage(conversation.id, 'assistant', 'estado posterior que não deve permanecer')
    database.close()

    fs.writeFileSync(path.join(root, 'nocturne.db'), 'database corrompido')
    await restoreDatabaseFile(root, snapshot)

    const restored = new LocalDatabase(root)
    expect(restored.listMessages(conversation.id).map((message) => message.content)).toEqual(['estado antes do restore'])
    restored.close()
    expect(fs.readdirSync(path.join(root, 'backups')).some((name) => name === path.basename(snapshot))).toBe(true)
  })
})
