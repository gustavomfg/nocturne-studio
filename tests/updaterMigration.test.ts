import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import productIdentity from '../shared/product-identity.json'

describe('migração da identidade do updater', () => {
  it('faz novos pacotes apontarem para o repositório canônico', () => {
    const builder = fs.readFileSync(path.join(process.cwd(), 'electron-builder.json5'), 'utf8')

    expect(productIdentity.repository).toBe('nocturne-studio')
    expect(builder).toContain('"owner": "gustavomfg"')
    expect(builder).toContain('"repo": "nocturne-studio"')
    expect(builder).not.toContain('"repo": "Nocturne-Codex"')
  })

  it('não exige o slug legado para uma instalação nova', () => {
    const updater = fs.readFileSync(path.join(process.cwd(), 'electron/updates/UpdateService.ts'), 'utf8')

    expect(updater).not.toContain('Nocturne-Codex')
    expect(updater).not.toContain('Nocturne Codex')
  })
})
