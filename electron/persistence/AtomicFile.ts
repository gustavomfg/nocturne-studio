import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

/**
 * Replaces a regular file without exposing a partially written payload.
 * The temporary file is synced before the same-directory rename so a process
 * interruption cannot turn a successful write into an empty/truncated file.
 */
export async function writeAtomicFile(filePath: string, content: string, mode = 0o600) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  let handle: fs.promises.FileHandle | undefined
  try {
    handle = await fs.promises.open(temporary, 'wx', mode)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.promises.chmod(temporary, mode)
    await fs.promises.rename(temporary, filePath)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.promises.unlink(temporary).catch(() => undefined)
    throw error
  }
}
