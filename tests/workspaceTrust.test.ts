import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSafeWorkspaceScope, inspectWorkspaceScope, isBlockedWorkspacePath } from '../electron/security/WorkspaceTrust'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

describe('confiança de workspace', () => {
  it('bloqueia raízes amplas e diretórios do sistema', () => {
    expect(() => assertSafeWorkspaceScope(path.parse(process.cwd()).root)).toThrow(/pasta de projeto específica/)
    expect(() => assertSafeWorkspaceScope(os.homedir())).toThrow(/pasta de projeto específica/)
  })

  it('normaliza symlinks antes de conceder confiança', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-workspace-'))
    directories.push(root)
    const project = path.join(root, 'project')
    const link = path.join(root, 'project-link')
    fs.mkdirSync(project)
    fs.symlinkSync(project, link, 'dir')
    expect(assertSafeWorkspaceScope(link)).toBe(fs.realpathSync.native(project))
  })

  it('trata aliases físicos de raízes bloqueadas sem bloquear filhos válidos', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-workspace-'))
    directories.push(root)
    const alias = `${root}-alias`
    fs.symlinkSync(root, alias, 'dir')

    expect(isBlockedWorkspacePath(alias, [root])).toBe(true)
    expect(isBlockedWorkspacePath(path.join(alias, 'project'), [root])).toBe(false)
    expect(isBlockedWorkspacePath(path.join(root, '..', path.basename(root)), [root])).toBe(true)
    expect(isBlockedWorkspacePath(`${root}-evil`, [root])).toBe(false)
    expect(isBlockedWorkspacePath(path.join(alias, 'new', 'project'), [root])).toBe(false)
  })

  it('distingue workspace ausente sem autorizar o caminho', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-workspace-'))
    directories.push(root)
    const missing = path.join(root, 'moved-project')
    expect(inspectWorkspaceScope(missing)).toEqual({
      availability: 'missing',
      path: missing,
      message: 'Pasta do projeto não encontrada.',
    })
    expect(() => assertSafeWorkspaceScope(missing)).toThrow(/não encontrada/)
    expect(assertSafeWorkspaceScope(missing, false)).toBe(missing)
  })

  it('rejeita arquivos no lugar de uma pasta de projeto', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-workspace-'))
    directories.push(root)
    const file = path.join(root, 'project.txt')
    fs.writeFileSync(file, '')
    expect(inspectWorkspaceScope(file)).toMatchObject({
      availability: 'invalid',
      message: 'O caminho do workspace não é uma pasta.',
    })
  })
})
