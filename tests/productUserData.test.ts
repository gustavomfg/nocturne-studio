import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateProductUserData } from '../electron/persistence/ProductUserData'

const directories: string[] = []
const createAppData = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-product-data-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('product user data migration', () => {
  it('uses the new product directory for a fresh installation', () => {
    const appData = createAppData()

    expect(migrateProductUserData(appData, 'Nocturne Studio', 'Nocturne Codex'))
      .toBe(path.join(appData, 'Nocturne Studio'))
  })

  it('atomically renames the legacy directory when the new directory is absent', () => {
    const appData = createAppData()
    const legacyPath = path.join(appData, 'Nocturne Codex')
    fs.mkdirSync(legacyPath)
    fs.writeFileSync(path.join(legacyPath, 'nocturne.db'), 'database')

    const result = migrateProductUserData(appData, 'Nocturne Studio', 'Nocturne Codex')

    expect(result).toBe(path.join(appData, 'Nocturne Studio'))
    expect(fs.readFileSync(path.join(result, 'nocturne.db'), 'utf8')).toBe('database')
    expect(fs.existsSync(legacyPath)).toBe(false)
  })

  it('keeps using legacy data if migration cannot be completed', () => {
    const appData = createAppData()
    const legacyPath = path.join(appData, 'Nocturne Codex')
    fs.mkdirSync(legacyPath)
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed')
    })

    expect(migrateProductUserData(appData, 'Nocturne Studio', 'Nocturne Codex'))
      .toBe(legacyPath)
  })

  it('does not hide a legacy database behind an incomplete new directory', () => {
    const appData = createAppData()
    const legacyPath = path.join(appData, 'Nocturne Codex')
    fs.mkdirSync(legacyPath)
    fs.writeFileSync(path.join(legacyPath, 'nocturne.db'), 'database')
    fs.mkdirSync(path.join(appData, 'Nocturne Studio'))

    expect(migrateProductUserData(appData, 'Nocturne Studio', 'Nocturne Codex'))
      .toBe(legacyPath)
  })

  it('does not hide a valid legacy database behind a corrupt new directory', () => {
    const appData = createAppData()
    const currentPath = path.join(appData, 'Nocturne Studio')
    const legacyPath = path.join(appData, 'Nocturne Codex')
    fs.mkdirSync(currentPath)
    fs.writeFileSync(path.join(currentPath, 'nocturne.db'), 'corrupt database')
    fs.mkdirSync(legacyPath)
    const legacyDatabase = new Sqlite(path.join(legacyPath, 'nocturne.db'))
    legacyDatabase.exec('CREATE TABLE state (value TEXT NOT NULL); PRAGMA user_version = 15;')
    legacyDatabase.prepare('INSERT INTO state(value) VALUES (?)').run('preserved')
    legacyDatabase.close()

    expect(migrateProductUserData(appData, 'Nocturne Studio', 'Nocturne Codex'))
      .toBe(legacyPath)
    expect(fs.readFileSync(path.join(currentPath, 'nocturne.db'), 'utf8')).toBe('corrupt database')
  })

  it('prefers populated legacy data over an empty database left by an interrupted startup', () => {
    const appData = createAppData()
    const currentPath = path.join(appData, 'Nocturne Studio')
    const legacyPath = path.join(appData, 'Nocturne Codex')
    fs.mkdirSync(currentPath)
    const emptyDatabase = new Sqlite(path.join(currentPath, 'nocturne.db'))
    emptyDatabase.close()
    fs.mkdirSync(legacyPath)
    const legacyDatabase = new Sqlite(path.join(legacyPath, 'nocturne.db'))
    legacyDatabase.exec('CREATE TABLE state (value TEXT NOT NULL); PRAGMA user_version = 15;')
    legacyDatabase.prepare('INSERT INTO state(value) VALUES (?)').run('preserved')
    legacyDatabase.close()

    expect(migrateProductUserData(appData, 'Nocturne Studio', 'Nocturne Codex'))
      .toBe(legacyPath)
  })
})
