import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentUpdateService } from '../electron/documents/DocumentUpdateService'
import { removeTestDirectory } from './helpers/platform'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    removeTestDirectory(directory)
  }
})

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-docs-'))
  directories.push(directory)
  return directory
}

describe('DocumentUpdateService', () => {
  it('anexa conteúdo somente depois de comparar o documento atual', async () => {
    const root = workspace()
    const target = path.join(root, 'README.md')
    fs.writeFileSync(target, '# Atual\n')
    const service = new DocumentUpdateService()
    const preview = await service.preview(root, target, '## Novo\n')

    expect(preview).toMatchObject({ existing: '# Atual\n', generated: '## Novo\n' })
    await service.apply(root, target, preview.generated, 'append', preview.expectedHash)

    expect(fs.readFileSync(target, 'utf8')).toBe('# Atual\n\n## Novo\n')
  })

  it('cria e substitui Markdown de forma explícita', async () => {
    const root = workspace()
    const target = path.join(root, 'guia.md')
    const service = new DocumentUpdateService()
    const creation = await service.preview(root, target, '# Guia')
    expect(creation.expectedHash).toBeNull()
    await service.apply(root, target, creation.generated, 'replace', creation.expectedHash)
    expect(fs.readFileSync(target, 'utf8')).toBe('# Guia\n')

    const replacement = await service.preview(root, target, '# Guia revisado')
    await service.apply(root, target, replacement.generated, 'replace', replacement.expectedHash)
    expect(fs.readFileSync(target, 'utf8')).toBe('# Guia revisado\n')
  })

  it('bloqueia a gravação se o arquivo mudar depois do preview', async () => {
    const root = workspace()
    const target = path.join(root, 'README.md')
    fs.writeFileSync(target, '# Antes\n')
    const service = new DocumentUpdateService()
    const preview = await service.preview(root, target, '# Proposta')
    fs.writeFileSync(target, '# Alteração externa\n')

    await expect(service.apply(root, target, preview.generated, 'replace', preview.expectedHash))
      .rejects.toThrow(/mudou depois do preview/)
    expect(fs.readFileSync(target, 'utf8')).toBe('# Alteração externa\n')
  })

  it('recusa destinos externos e formatos que não sejam Markdown', async () => {
    const root = workspace()
    const service = new DocumentUpdateService()
    await expect(service.preview(root, path.join(root, '..', 'fora.md'), '# Fora')).rejects.toThrow()
    await expect(service.preview(root, path.join(root, 'documento.txt'), 'texto')).rejects.toThrow(/Markdown/)
  })
})
