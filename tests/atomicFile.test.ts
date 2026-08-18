import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeAtomicFile } from '../electron/persistence/AtomicFile'

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('escrita atômica de arquivos persistentes', () => {
  it('sincroniza o conteúdo antes de substituir o arquivo oficial', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-atomic-write-'))
    directories.push(root)
    const filePath = path.join(root, 'project.json')

    await writeAtomicFile(filePath, '{"version":1}')

    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"version":1}')
    expect(fs.readdirSync(root)).toEqual(['project.json'])
  })

  it('preserva o original e remove o temporário quando o replace falha', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-atomic-write-failure-'))
    directories.push(root)
    const filePath = path.join(root, 'memory.md')
    fs.writeFileSync(filePath, 'conteúdo anterior')
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('rename denied'))

    await expect(writeAtomicFile(filePath, 'conteúdo novo')).rejects.toThrow('rename denied')

    expect(fs.readFileSync(filePath, 'utf8')).toBe('conteúdo anterior')
    expect(fs.readdirSync(root)).toEqual(['memory.md'])
  })
})
