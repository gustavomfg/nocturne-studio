import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutable } from '../electron/runtime/resolveExecutable'

describe('resolveExecutable', () => {
  it('resolve um executável nativo usando o locator da plataforma', async () => {
    const executable = await resolveExecutable(process.platform === 'win32' ? 'cmd' : 'sh')
    expect(executable).not.toBeNull()
    expect(path.isAbsolute(executable as string)).toBe(true)
  })

  it('retorna null quando o executável não existe', async () => {
    await expect(resolveExecutable('nocturne-executable-that-does-not-exist')).resolves.toBeNull()
  })
})
