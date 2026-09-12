import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDiscoveryService, classifyFile } from '../electron/project-index/WorkspaceDiscoveryService'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('descoberta do workspace', () => {
  it('descobre arquivos relevantes, configurações e exclusões sem seguir links', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-discovery-'))
    directories.push(workspace)
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'node_modules', 'dependency'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'package.json'), '{"scripts":{"test":"vitest"}}')
    fs.writeFileSync(path.join(workspace, 'src', 'App.tsx'), 'export function App() {}')
    fs.writeFileSync(path.join(workspace, 'README.md'), '# Projeto')
    fs.writeFileSync(path.join(workspace, 'node_modules', 'dependency', 'index.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(workspace, 'dist', 'bundle.js'), 'generated')
    fs.symlinkSync(path.join(workspace, 'src'), path.join(workspace, 'linked-src'), 'dir')

    const result = await new WorkspaceDiscoveryService().discover(workspace)

    expect(result.workspace).toBe(path.resolve(workspace))
    expect(result.files.map((file) => file.relativePath)).toEqual(['README.md', 'package.json', 'src/App.tsx'])
    expect(result.configurationFiles).toEqual(['package.json'])
    expect(result.exclusions).toEqual(expect.arrayContaining([
      { relativePath: 'dist', reason: expect.any(String) },
      { relativePath: 'linked-src', reason: expect.stringContaining('simbólicos') },
      { relativePath: 'node_modules', reason: expect.any(String) },
    ]))
    expect(result.files.find((file) => file.relativePath === 'src/App.tsx')).toMatchObject({ classification: 'source', extension: '.tsx' })
  })

  it('aplica o limite de arquivos e mantém a descoberta determinística', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-discovery-limit-'))
    directories.push(workspace)
    for (const name of ['z.ts', 'a.ts', 'm.ts']) fs.writeFileSync(path.join(workspace, name), name)

    const result = await new WorkspaceDiscoveryService({ maxFiles: 2 }).discover(workspace)

    expect(result.files).toHaveLength(2)
    expect(result.files.map((file) => file.relativePath)).toEqual(['a.ts', 'm.ts'])
    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toBe('storage')
    expect(result.exclusions).toEqual(expect.arrayContaining([{ relativePath: 'z.ts', reason: expect.stringContaining('Limite') }]))
  })

  it('aplica exclusões estruturais em qualquer segmento do caminho', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-discovery-nested-'))
    directories.push(workspace)
    fs.mkdirSync(path.join(workspace, 'packages', 'app', 'node_modules', 'dependency'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'packages', 'app', 'src'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'packages', 'app', 'node_modules', 'dependency', 'index.js'), 'ignored')
    fs.writeFileSync(path.join(workspace, 'packages', 'app', 'src', 'main.ts'), 'export const main = true')

    const result = await new WorkspaceDiscoveryService().discover(workspace)

    expect(result.files.map((file) => file.relativePath)).toEqual(['packages/app/src/main.ts'])
    expect(result.exclusions).toEqual(expect.arrayContaining([
      { relativePath: 'packages/app/node_modules', reason: expect.any(String) },
    ]))
  })

  it('interrompe a travessia quando o orçamento de trabalho é atingido', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-discovery-traversal-'))
    directories.push(workspace)
    fs.mkdirSync(path.join(workspace, 'a', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'a', 'first.ts'), 'first')
    fs.writeFileSync(path.join(workspace, 'a', 'deep', 'second.ts'), 'second')
    fs.writeFileSync(path.join(workspace, 'z.ts'), 'last')

    const result = await new WorkspaceDiscoveryService({ maxTraversalEntries: 2 }).discover(workspace)

    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toBe('traversal')
    expect(result.exclusions).toEqual(expect.arrayContaining([
      { relativePath: expect.any(String), reason: expect.stringContaining('travess') },
    ]))
  })
})

describe('classificação de arquivos', () => {
  it.each([
    ['package.json', 'configuration'],
    ['tsconfig.node.json', 'configuration'],
    ['vite.config.custom.ts', 'configuration'],
    ['requirements-dev.txt', 'configuration'],
    ['Cargo.toml', 'configuration'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['README.md', 'documentation'],
    ['src/main.ts', 'source'],
    ['config.yaml', 'asset'],
    ['image.png', 'unknown'],
  ])('%s é classificado como %s', (file, classification) => {
    expect(classifyFile(file)).toBe(classification)
  })
})
