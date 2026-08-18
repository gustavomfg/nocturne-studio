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

  it('preserva o original quando a escrita falha depois de abrir o temporário', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-atomic-write-write-failure-'))
    directories.push(root)
    const filePath = path.join(root, 'rules.md')
    fs.writeFileSync(filePath, 'regras anteriores')
    const open = vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (temporaryPath) => {
      fs.writeFileSync(temporaryPath, 'conteúdo parcial', { mode: 0o600 })
      return {
        writeFile: vi.fn().mockRejectedValue(new Error('ENOSPC simulado')),
        sync: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } as never
    })

    await expect(writeAtomicFile(filePath, 'regras novas')).rejects.toThrow('ENOSPC simulado')

    expect(open).toHaveBeenCalledWith(expect.stringContaining('.tmp-'), 'wx', 0o600)
    expect(fs.readFileSync(filePath, 'utf8')).toBe('regras anteriores')
    expect(fs.readdirSync(root)).toEqual(['rules.md'])
  })

  it('substitui repetidamente o destino sem deixar temporários', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-atomic-write-repeat-'))
    directories.push(root)
    const filePath = path.join(root, 'project.json')

    await writeAtomicFile(filePath, '{"revision":1}')
    await writeAtomicFile(filePath, '{"revision":2}')
    await writeAtomicFile(filePath, '{"revision":3}')

    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"revision":3}')
    expect(fs.readdirSync(root)).toEqual(['project.json'])
  })

  it('aplica a permissão restritiva quando o sistema oferece chmod', async () => {
    if (process.platform === 'win32') return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-atomic-write-mode-'))
    directories.push(root)
    const filePath = path.join(root, 'memory.md')

    await writeAtomicFile(filePath, 'conteúdo')

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
  })
})
