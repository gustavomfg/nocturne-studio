import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assessCommand, externalOpenRiskExtensionsByPlatform, isExternalOpenBlocked, resolveInsideWorkspace } from '../electron/security/ExecutionPolicy'
import { redactLogText, redactLogValue } from '../electron/logging/Logger'
import { canonicalTestPath, removeTestDirectory } from './helpers/platform'

describe('políticas de execução', () => {
  it('mantém permissões web negadas e fuses essenciais no pacote', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')
    const builder = fs.readFileSync(path.join(process.cwd(), 'electron-builder.json5'), 'utf8')
    expect(main).toContain('setPermissionCheckHandler(() => false)')
    expect(main).toContain('callback(false)')
    expect(builder).toMatch(/"runAsNode": false/)
    expect(builder).toMatch(/"onlyLoadAppFromAsar": true/)
  })
  it('mantém apenas os locales suportados e usa compressão de release', () => {
    const builder = fs.readFileSync(path.join(process.cwd(), 'electron-builder.json5'), 'utf8')
    expect(builder).toContain('"compression": "maximum"')
    expect(builder).toContain('"electronLanguages": ["en-US", "pt-BR"]')
  })
  it('gera metadados de atualização pelo GitHub sem consultar o serviço em desenvolvimento', () => {
    const builder = fs.readFileSync(path.join(process.cwd(), 'electron-builder.json5'), 'utf8')
    const updater = fs.readFileSync(path.join(process.cwd(), 'electron/updates/UpdateService.ts'), 'utf8')
    expect(builder).toContain('"provider": "github"')
    expect(builder).toContain('"repo": "Nocturne-Codex"')
    expect(updater).toContain('if (!app.isPackaged || process.env.NOCTURNE_PACKAGE_SMOKE_OUTPUT)')
    expect(updater).toContain('updater.autoDownload = false')
  })
  it('exercita bloqueios de janela e navegação no smoke empacotado', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')
    expect(main).toContain("window.open('about:blank', '_blank')")
    expect(main).toContain("on('will-frame-navigate'")
    expect(main).toContain("link.href = 'https://example.invalid/nocturne-package-smoke'")
    expect(main).toContain('finalUrl === originalUrl')
    expect(main).not.toContain('const navigation = { externalWindowsDenied: true, unexpectedNavigationBlocked: true }')
  })
  it('remove credenciais completas de strings e objetos de log', () => {
    for (const value of [
      'Authorization: Bearer segredo-super-secreto',
      'authorization=Basic YWxhZGRpbjpvcGVuc2VzYW1l',
      'token="valor com espaços"',
      '{"api_key":"chave-json","ok":true}',
    ]) {
      const redacted = redactLogText(value)
      expect(redacted).toContain('[REDACTED]')
      expect(redacted).not.toMatch(/segredo-super-secreto|YWxhZGRpb|valor com espaços|chave-json/)
    }
    expect(redactLogValue({ authorization: 'Bearer segredo', prompt: 'pedido privado', content: 'arquivo completo', error: 'falha com dados privados', nested: { password: 'senha', safe: 'ok' } })).toEqual({ nested: { safe: 'ok' } })
  })
  it('publica uma release estável somente após reunir e verificar as três plataformas', () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/stable-release.yml'), 'utf8')
    expect(workflow).toContain('pattern: nocturne-signed-*')
    expect(workflow).toContain('npm run verify:release-assets -- release-assets')
    expect(workflow).toContain('gh release create "$RELEASE_TAG"')
    expect(workflow).toContain('tag !== \'v\'+v')
    expect(workflow).toContain('git rev-list -n 1 "$RELEASE_TAG"')
    expect(workflow).not.toContain('${{ runner.os ==')
    expect(workflow).toContain("matrix.os == 'macos-latest'")
    expect(workflow).toContain("matrix.os == 'windows-latest' && secrets.WIN_CSC_LINK")
    expect(workflow).toContain('environment: stable-release')
  })
  it('não registra o smoke manual do Codex como deployment', () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/codex-contract-smoke.yml'), 'utf8')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('runs-on: [self-hosted, nocturne-studio]')
    expect(workflow).not.toContain('environment:')
    expect(workflow).not.toContain('schedule:')
  })
  it('mantém o atalho de editor integrado ao WebStorm', () => {
    const workspaceIpc = fs.readFileSync(path.join(process.cwd(), 'electron/ipc/registerWorkspaceIpc.ts'), 'utf8')
    const topbar = fs.readFileSync(path.join(process.cwd(), 'src/domains/workspaces/WorkspaceTopbar.tsx'), 'utf8')
    expect(workspaceIpc).toContain("dependencies.run('webstorm', [workspace], workspace)")
    expect(workspaceIpc).toContain('Não foi possível abrir o WebStorm.')
    expect(topbar).toContain("aria-label={t('topbar.openWebstorm')}")
  })
  it.each(['sudo apt update', 'git reset --hard HEAD', 'git clean -fd', 'rm -rf build', 'npm run rebuild:native', 'npm run package'])('marca comando perigoso: %s', (command) => expect(assessCommand(command)).toMatchObject({ risk: 'dangerous', requiresApproval: true, blockedAutomatic: true }))
  it('não usa substring ingênua para classificar nomes de arquivo', () => expect(assessCommand(['cat', 'sudo-notes.md']).risk).toBe('safe'))
  it('bloqueia todos os formatos de abertura externa definidos pela plataforma', () => {
    for (const [platform, extensions] of Object.entries(externalOpenRiskExtensionsByPlatform)) {
      for (const extension of extensions) expect(isExternalOpenBlocked(`arquivo${extension}`, platform as NodeJS.Platform)).toBe(true)
    }
  })
  it.each([
    ['win32', '.pdf'],
    ['darwin', '.pdf'],
    ['linux', '.pdf'],
  ] as const)('permite formato não executável em %s', (platform, extension) => expect(isExternalOpenBlocked(`arquivo${extension}`, platform)).toBe(false))
  it('bloqueia traversal e aceita arquivo interno', () => {
    const workspace = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-security-')))
    expect(() => resolveInsideWorkspace('../secret', workspace)).toThrow(/fora do workspace/)
    expect(resolveInsideWorkspace('src/app.ts', workspace)).toBe(path.join(workspace, 'src/app.ts'))
    removeTestDirectory(workspace)
  })
  it('bloqueia symlink interno que aponta para fora do workspace', () => {
    const workspace = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-security-')))
    const outside = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-outside-')))
    fs.symlinkSync(outside, path.join(workspace, 'escape'))
    expect(() => resolveInsideWorkspace('escape/secret.txt', workspace)).toThrow(/fora do workspace/)
    removeTestDirectory(workspace); removeTestDirectory(outside)
  })
  it('fixa o caminho real antes de uma troca concorrente de symlink', () => {
    const workspace = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-security-')))
    const outside = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-outside-')))
    const safe = path.join(workspace, 'safe')
    const link = path.join(workspace, 'link')
    fs.mkdirSync(safe)
    fs.writeFileSync(path.join(safe, 'secret.txt'), 'interno')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'externo')
    fs.symlinkSync(safe, link, 'dir')

    const resolved = resolveInsideWorkspace('link/secret.txt', workspace)
    fs.unlinkSync(link)
    fs.symlinkSync(outside, link, 'dir')

    expect(resolved).toBe(path.join(safe, 'secret.txt'))
    expect(fs.readFileSync(resolved, 'utf8')).toBe('interno')
    removeTestDirectory(workspace); removeTestDirectory(outside)
  })
})
