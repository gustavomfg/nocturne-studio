import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electron = require('electron') as string
const databaseModule = require.resolve('better-sqlite3')
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('interrupção real de processo durante transações SQLite', () => {
  it('não expõe uma transação não confirmada depois da morte do processo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-process-rollback-'))
    directories.push(root)
    const filePath = path.join(root, 'state.db')
    prepareDatabase(filePath)

    const result = runChild(filePath, 'rollback')
    expect(result.status).not.toBe(0)

    const database = new Sqlite(filePath, { readonly: true })
    expect(database.prepare('SELECT value FROM state').all()).toEqual([])
    database.close()
  })

  it('preserva uma transação confirmada antes da morte do processo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-process-commit-'))
    directories.push(root)
    const filePath = path.join(root, 'state.db')
    prepareDatabase(filePath)

    const result = runChild(filePath, 'commit')
    expect(result.status).not.toBe(0)

    const database = new Sqlite(filePath, { readonly: true })
    expect(database.prepare('SELECT value FROM state').all()).toEqual([{ value: 'committed' }])
    database.close()
  })
})

function prepareDatabase(filePath: string) {
  const database = new Sqlite(filePath)
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = FULL')
  database.exec('CREATE TABLE state (value TEXT NOT NULL)')
  database.close()
}

function runChild(filePath: string, mode: 'rollback' | 'commit') {
  const terminationSignal = process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL'
  const source = `
    const Database = require(${JSON.stringify(databaseModule)});
    const database = new Database(${JSON.stringify(filePath)});
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    if (${JSON.stringify(mode)} === 'rollback') {
      database.exec('BEGIN IMMEDIATE');
      database.prepare('INSERT INTO state(value) VALUES (?)').run('uncommitted');
    } else {
      database.transaction(() => database.prepare('INSERT INTO state(value) VALUES (?)').run('committed'))();
    }
    process.kill(process.pid, ${JSON.stringify(terminationSignal)});
  `
  return spawnSync(electron, ['-e', source], {
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
}
