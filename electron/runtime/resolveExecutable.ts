import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function resolveExecutable(name: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const { stdout } = await execFileAsync(locator, [name], { timeout: 5_000, windowsHide: true })
    for (const candidate of stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      if (!path.isAbsolute(candidate)) continue
      try {
        await fs.promises.access(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        // Try the next path returned by the platform locator.
      }
    }
  } catch {
    return null
  }
  return null
}
