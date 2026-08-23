import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolves an existing path physically and appends any not-yet-created suffix
 * lexically. This preserves filesystem aliases such as /var and /private/var
 * without applying realpath to a path that does not exist yet.
 */
export function canonicalizePackagedRecoveryPath(value: string) {
  const resolved = path.resolve(value)
  let existing = resolved
  while (!fs.existsSync(existing)) {
    try {
      if (fs.lstatSync(existing).isSymbolicLink()) return null
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null
    }
    const parent = path.dirname(existing)
    if (parent === existing) return null
    existing = parent
  }

  try {
    const realExisting = fs.realpathSync.native(existing)
    return path.resolve(realExisting, path.relative(existing, resolved))
  } catch {
    return null
  }
}

export function isPackagedRecoveryPathInside(parent: string, candidate: string) {
  const canonicalParent = canonicalizePackagedRecoveryPath(parent)
  const canonicalCandidate = canonicalizePackagedRecoveryPath(candidate)
  if (!canonicalParent || !canonicalCandidate) return false

  const relative = path.relative(canonicalParent, canonicalCandidate)
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  )
}
