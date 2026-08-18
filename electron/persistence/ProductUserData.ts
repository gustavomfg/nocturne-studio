import fs from 'node:fs'
import path from 'node:path'
import { inspectDatabaseFile, isRecoverableDatabaseCorruption } from '../database/recovery'

const DATABASE_FILENAME = 'nocturne.db'

interface DatabaseState {
  status: 'missing' | 'valid' | 'invalid' | 'unknown'
  schemaVersion?: number
}

function databaseState(databasePath: string): DatabaseState {
  if (!fs.existsSync(databasePath)) return { status: 'missing' }
  try {
    return { status: 'valid', schemaVersion: inspectDatabaseFile(databasePath).schemaVersion }
  } catch (error) {
    return { status: isRecoverableDatabaseCorruption(error) ? 'invalid' : 'unknown' }
  }
}

export function migrateProductUserData(appDataPath: string, currentName: string, legacyName: string) {
  const currentPath = path.join(appDataPath, currentName)
  const legacyPath = path.join(appDataPath, legacyName)

  if (fs.existsSync(currentPath)) {
    const currentDatabase = path.join(currentPath, DATABASE_FILENAME)
    const legacyDatabase = path.join(legacyPath, DATABASE_FILENAME)
    const currentState = databaseState(currentDatabase)
    const legacyState = databaseState(legacyDatabase)
    const currentIsEmpty = currentState.status === 'valid' && currentState.schemaVersion === 0
    const legacyIsUsable = legacyState.status === 'valid' && (legacyState.schemaVersion ?? 0) > 0
    return (currentState.status === 'missing' && legacyState.status !== 'missing') ||
      (currentState.status === 'invalid' && legacyIsUsable) ||
      (currentIsEmpty && legacyIsUsable)
      ? legacyPath
      : currentPath
  }

  if (!fs.existsSync(legacyPath)) return currentPath

  try {
    fs.renameSync(legacyPath, currentPath)
    return currentPath
  } catch {
    return legacyPath
  }
}
