import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasDatabaseRecoveryArtifacts, inspectDatabaseFile, isRecoverableDatabaseCorruption, listDatabaseRecoveryCandidates, restoreDatabaseFile } from '../electron/database/recovery'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

function createDatabase(filePath: string, value: string) {
  const database = new Sqlite(filePath)
  database.exec('CREATE TABLE state (value TEXT NOT NULL); PRAGMA user_version = 1;')
  database.prepare('INSERT INTO state(value) VALUES(?)').run(value)
  database.close()
}

describe('recuperação do banco', () => {
  it('detecta artefatos de uma recuperação interrompida', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-artifacts-'))
    directories.push(root)

    expect(hasDatabaseRecoveryArtifacts(root)).toBe(false)
    fs.mkdirSync(path.join(root, 'database-corrupt-interrupted'))
    expect(hasDatabaseRecoveryArtifacts(root)).toBe(true)
    fs.rmSync(path.join(root, 'database-corrupt-interrupted'), { recursive: true })
    fs.writeFileSync(path.join(root, 'nocturne.db.recovery-123'), 'partial copy')
    expect(hasDatabaseRecoveryArtifacts(root)).toBe(true)
  })

  it('distingue corrupção de falhas de permissão ou acesso', () => {
    expect(isRecoverableDatabaseCorruption(Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' }))).toBe(true)
    expect(isRecoverableDatabaseCorruption(Object.assign(new Error('permission denied'), { code: 'EACCES' }))).toBe(false)
  })

  it('detecta um SQLite truncado como corrupção real', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-truncated-'))
    directories.push(root)
    const filePath = path.join(root, 'nocturne.db')
    createDatabase(filePath, 'preserved')
    fs.truncateSync(filePath, 32)

    expect(() => inspectDatabaseFile(filePath)).toThrow()
  })

  it('oferece somente snapshots íntegros e compatíveis, do mais recente ao mais antigo', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-list-'))
    directories.push(root)
    const backups = path.join(root, 'backups')
    fs.mkdirSync(backups)
    const older = path.join(root, 'nocturne.db.backup-1.db')
    const interrupted = path.join(root, 'nocturne.db.recovery-interrupted')
    const newer = path.join(backups, 'nocturne-before-restore-2.db')
    const invalid = path.join(backups, 'nocturne-before-restore-invalid.db')
    createDatabase(older, 'older')
    createDatabase(interrupted, 'interrupted')
    createDatabase(newer, 'newer')
    fs.writeFileSync(invalid, 'arquivo inválido')
    const oldTime = new Date('2026-01-01T00:00:00.000Z')
    const interruptedTime = new Date('2026-01-01T12:00:00.000Z')
    const newTime = new Date('2026-01-02T00:00:00.000Z')
    fs.utimesSync(older, oldTime, oldTime)
    fs.utimesSync(interrupted, interruptedTime, interruptedTime)
    fs.utimesSync(newer, newTime, newTime)

    const candidates = await listDatabaseRecoveryCandidates(root)

    expect(candidates.map((item) => item.path)).toEqual([newer, interrupted, older])
    expect(candidates.every((item) => item.schemaVersion === 1)).toBe(true)
  })

  it('restaura uma cópia verificada e preserva o banco corrompido em quarentena', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-restore-'))
    directories.push(root)
    const current = path.join(root, 'nocturne.db')
    const backup = path.join(root, 'nocturne.db.backup-valid.db')
    fs.writeFileSync(current, 'banco corrompido')
    fs.writeFileSync(`${current}-wal`, 'wal corrompido')
    createDatabase(backup, 'restored')

    const quarantine = await restoreDatabaseFile(root, backup)

    expect(inspectDatabaseFile(current)).toEqual({ schemaVersion: 1 })
    const restored = new Sqlite(current, { readonly: true })
    expect((restored.prepare('SELECT value FROM state').get() as { value: string }).value).toBe('restored')
    restored.close()
    expect(fs.readFileSync(path.join(quarantine, 'nocturne.db'), 'utf8')).toBe('banco corrompido')
    expect(fs.readFileSync(path.join(quarantine, 'nocturne.db-wal'), 'utf8')).toBe('wal corrompido')
  })

  it('devolve o arquivo original ao lugar quando a cópia de recuperação é inválida', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-rollback-'))
    directories.push(root)
    const current = path.join(root, 'nocturne.db')
    const invalidBackup = path.join(root, 'invalid-backup.db')
    fs.writeFileSync(current, 'estado original')
    fs.writeFileSync(invalidBackup, 'cópia inválida')

    await expect(restoreDatabaseFile(root, invalidBackup)).rejects.toThrow(/arquivo original foi preservado/)

    expect(fs.readFileSync(current, 'utf8')).toBe('estado original')
    expect(fs.readdirSync(root).some((name) => name.startsWith('database-corrupt-'))).toBe(false)
  })

  it('reverte o movimento do original quando a cópia é interrompida', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-interruption-'))
    directories.push(root)
    const current = path.join(root, 'nocturne.db')
    const backup = path.join(root, 'nocturne.db.backup-valid.db')
    fs.writeFileSync(current, 'estado original')
    createDatabase(backup, 'restored')
    vi.spyOn(fs.promises, 'copyFile').mockRejectedValueOnce(new Error('cópia interrompida'))

    await expect(restoreDatabaseFile(root, backup)).rejects.toThrow(/arquivo original foi preservado/)

    expect(fs.readFileSync(current, 'utf8')).toBe('estado original')
    expect(fs.existsSync(backup)).toBe(true)
    expect(fs.readdirSync(root).some((name) => name.startsWith('database-corrupt-'))).toBe(false)
  })
})
