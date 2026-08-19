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
