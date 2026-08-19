import fs from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'

/**
 * Resolves a test path the same way the main process resolves workspace paths.
 * This accounts for macOS /tmp aliases and Windows 8.3 path aliases without
 * weakening the production containment checks.
 */
export function canonicalTestPath(candidate: string) {
  const resolved = path.resolve(candidate)
  let existing = resolved
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) return resolved
    existing = parent
  }
  const realExisting = fs.realpathSync.native(existing)
  return path.resolve(realExisting, path.relative(existing, resolved))
}

/**
 * Windows does not expose POSIX permission bits through stat(). The product
 * still requests restrictive modes there, but mode-bit assertions are only
 * meaningful on POSIX filesystems.
 */
export function expectUserOnlyMode(mode: number) {
  if (process.platform !== 'win32') expect(mode & 0o777).toBe(0o600)
}

/**
 * SQLite, Git, and native filesystem handles can be released slightly after a
 * test finishes on Windows. Keep cleanup bounded while allowing that release
 * to complete; a persistent failure still propagates from fs.rmSync().
 */
export function removeTestDirectory(directory: string) {
  const windows = process.platform === 'win32'
  fs.rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: windows ? 20 : 0,
    retryDelay: windows ? 50 : 100,
  })
}

const WINDOWS_CLEANUP_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY'])
const WINDOWS_CLEANUP_TIMEOUT_MS = 8_000

async function remainingEntries(directory: string) {
  const entries: string[] = []

  const visit = async (current: string): Promise<void> => {
    const children = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      const childPath = path.join(current, child.name)
      entries.push(path.relative(directory, childPath) || child.name)
      if (child.isDirectory() && !child.isSymbolicLink()) await visit(childPath)
    }
  }

  await visit(directory)
  return entries
}

/**
 * Removes a test fixture without masking Windows handle-release failures.
 * Retries happen only after the filesystem reports a transient Windows
 * cleanup error and stop at a fixed deadline; production code does not use
 * this helper.
 */
export async function removeTestDirectoryAsync(directory: string) {
  const deadline = Date.now() + WINDOWS_CLEANUP_TIMEOUT_MS
  let attempt = 0
  let lastError: unknown

  while (true) {
    try {
      await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 0 })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || !code || !WINDOWS_CLEANUP_RETRY_CODES.has(code)) throw error
      lastError = error
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        const entries = await remainingEntries(directory)
        const detail = entries.length ? entries.slice(0, 50).join(', ') : '(diretório indisponível)'
        throw new Error(`Falha ao remover fixture Windows (${code}) após ${WINDOWS_CLEANUP_TIMEOUT_MS}ms; entradas restantes: ${detail}; causa: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
      }

      const delay = Math.min(25 * (2 ** attempt), 250, remaining)
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
      attempt += 1
    }
  }
}
