import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { DATABASE_SCHEMA_VERSION } from '../../shared/constants'

export interface DatabaseRecoveryCandidate {
  path: string
  schemaVersion: number
  modifiedAt: string
}

export function hasDatabaseRecoveryArtifacts(userDataPath: string) {
  try {
    return fs.readdirSync(userDataPath).some((name) =>
      name.startsWith('database-corrupt-') || name.startsWith('nocturne.db.recovery-'))
  } catch {
    return false
  }
}

export function isRecoverableDatabaseCorruption(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') return true
  const message = error instanceof Error ? error.message : String(error)
  return /(?:database disk image is malformed|file is not a database|falha de integridade)/i.test(message)
}

export function inspectDatabaseFile(filePath: string) {
  let database: Database.Database | null = null
  try {
    database = new Database(filePath, { readonly: true, fileMustExist: true })
    const integrity = database.pragma('quick_check', { simple: true }) as string
    if (integrity !== 'ok') throw new Error(`Falha de integridade: ${integrity}.`)
    const schemaVersion = database.pragma('user_version', { simple: true }) as number
    return { schemaVersion }
  } finally {
    database?.close()
  }
}

export async function listDatabaseRecoveryCandidates(userDataPath: string): Promise<DatabaseRecoveryCandidate[]> {
  const locations = [
    { directory: userDataPath, accepts: (name: string) => name.startsWith('nocturne.db.backup-') && !name.endsWith('-wal') && !name.endsWith('-shm') },
    { directory: userDataPath, accepts: (name: string) => name.startsWith('nocturne.db.recovery-') && !name.endsWith('-wal') && !name.endsWith('-shm') },
    { directory: path.join(userDataPath, 'backups'), accepts: (name: string) => name.startsWith('nocturne-before-restore-') && name.endsWith('.db') },
  ]
  const candidates: DatabaseRecoveryCandidate[] = []
  for (const location of locations) {
    const names = await fs.promises.readdir(location.directory).catch(() => [])
    for (const name of names) {
      if (!location.accepts(name)) continue
      const candidatePath = path.join(location.directory, name)
      try {
        const [{ schemaVersion }, stat] = await Promise.all([
          Promise.resolve(inspectDatabaseFile(candidatePath)),
          fs.promises.stat(candidatePath),
        ])
        if (schemaVersion >= 1 && schemaVersion <= DATABASE_SCHEMA_VERSION) {
          candidates.push({ path: candidatePath, schemaVersion, modifiedAt: stat.mtime.toISOString() })
        }
      } catch {
        // Uma cópia inválida nunca é oferecida como origem de recuperação.
      }
    }
  }
  return candidates.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))
}

export async function restoreDatabaseFile(userDataPath: string, sourcePath: string) {
  const databasePath = path.join(userDataPath, 'nocturne.db')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const quarantine = path.join(userDataPath, `database-corrupt-${timestamp}`)
  const temporary = path.join(userDataPath, `nocturne.db.recovery-${process.pid}-${timestamp}`)
  await fs.promises.mkdir(quarantine, { mode: 0o700 })
  const moved: Array<{ source: string; destination: string }> = []
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${databasePath}${suffix}`
      try {
        const destination = path.join(quarantine, `nocturne.db${suffix}`)
        await fs.promises.rename(source, destination)
        moved.push({ source, destination })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await fs.promises.copyFile(sourcePath, temporary, fs.constants.COPYFILE_EXCL)
    await fs.promises.chmod(temporary, 0o600)
    const restoredHandle = await fs.promises.open(temporary, 'r+')
    try {
      await restoredHandle.sync()
    } finally {
      await restoredHandle.close()
    }
    inspectDatabaseFile(temporary)
    await fs.promises.rename(temporary, databasePath)
    return quarantine
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => undefined)
    if (moved.some((item) => item.source === databasePath)) await fs.promises.unlink(databasePath).catch(() => undefined)
    for (const item of moved.reverse()) await fs.promises.rename(item.destination, item.source).catch(() => undefined)
    await fs.promises.rmdir(quarantine).catch(() => undefined)
    throw new Error(`A recuperação do banco falhou; o arquivo original foi preservado: ${error instanceof Error ? error.message : String(error)}`)
  }
}
