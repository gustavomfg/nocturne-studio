import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import productIdentity from '../shared/product-identity.json'

describe('migração da identidade do updater', () => {
  it('ensaia a base publicada 1.0.1 sem falsificar a versão do candidato', () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/updater-rehearsal.yml'), 'utf8')
    expect(workflow).toContain('UPDATER_REHEARSAL_BASE_COMMIT: 0f6cd580c447e50e37d48523d5d1667c691f8286')
    expect(workflow).toContain('git rev-list -n 1 v1.0.1')
    expect(workflow).toContain("v!==require('./package.json').version")
    expect(workflow).not.toContain('-c.extraMetadata.version=')
    expect(workflow).not.toContain('${{ inputs.candidate_version }} -c.')
  })
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
