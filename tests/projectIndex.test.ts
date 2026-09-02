import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { WorkspaceDiscoveryService } from '../electron/project-index/WorkspaceDiscoveryService'
import { ProjectIndexService } from '../electron/project-index/ProjectIndexService'
import type { ValidationRun } from '../shared/codeIntelligence'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Project Index', () => {
  it('indexa arquivos, símbolos, stack e relações com hashes persistidos', async () => {
    const fixture = createFixture()
    fs.mkdirSync(path.join(fixture.workspace, 'src'), { recursive: true })
    fs.writeFileSync(path.join(fixture.workspace, 'package.json'), JSON.stringify({
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^8.0.0', vitest: '^4.0.0' },
      scripts: { test: 'vitest', build: 'vite build' },
    }))
    fs.writeFileSync(path.join(fixture.workspace, 'src', 'util.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(fixture.workspace, 'src', 'main.ts'), [
      "import { value } from './util'",
      'export function main() { return value }',
      "export { value as answer } from './util'",
    ].join('\n'))
    fs.mkdirSync(path.join(fixture.workspace, 'node_modules', 'ignored'), { recursive: true })
    fs.writeFileSync(path.join(fixture.workspace, 'node_modules', 'ignored', 'index.js'), 'export const ignored = true')

    const statuses: string[] = []
    const metrics: Array<{ durationMs: number; parserDurationsMs: Record<string, number> }> = []
    const service = new ProjectIndexService(fixture.database.projectIndex, { onStatus: (status) => statuses.push(status.status), onMetric: (metric) => metrics.push(metric) })
    await service.ensureIndexed(fixture.workspace)

    const summary = service.getSummary(fixture.workspace)
    const symbols = service.listSymbols(fixture.workspace)
    const imports = service.listImports(fixture.workspace)
    const exports = service.listExports(fixture.workspace)
    const stack = service.listStackEvidence(fixture.workspace)
    const aiContext = service.buildAiContext(fixture.workspace, 'main')

    expect(summary.files).toBe(3)
    expect(summary.indexedFiles).toBe(2)
    expect(summary.unsupportedFiles).toBe(1)
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'main', kind: 'function', relativePath: 'src/main.ts' }),
      expect.objectContaining({ name: 'value', kind: 'variable', relativePath: 'src/util.ts', exported: true }),
    ]))
    expect(imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: 'src/main.ts', specifier: './util', targetPath: 'src/util.ts', resolution: 'local', targetHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]))
    expect(exports).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: 'src/main.ts', name: 'answer', targetPath: 'src/util.ts', targetHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]))
    expect(stack).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'runtime', value: 'Node.js', sourcePath: 'package.json', sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ category: 'framework', value: 'React' }),
      expect.objectContaining({ category: 'bundler', value: 'Vite' }),
      expect.objectContaining({ category: 'test', value: 'Vitest' }),
    ]))
    expect(aiContext?.text).toContain('Evidência runtime=Node.js em package.json')
    expect(aiContext?.text).toContain('hash')
    expect(aiContext?.selections).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'project-index', kind: 'project-file', analyzedHash: expect.stringMatching(/^[a-f0-9]{64}$/) })]))
    expect(statuses).toContain('running')
    expect(statuses[statuses.length - 1]).toBe('completed')
    expect(metrics).toEqual([expect.objectContaining({ durationMs: expect.any(Number), parserDurationsMs: expect.objectContaining({ typescript: expect.any(Number) }) })])
    expect(service.getMetrics()).toMatchObject({ runs: 1, filesProcessed: 3, failedFiles: 0 })
  })

  it('processa somente o arquivo alterado e preserva o restante do índice', async () => {
    const fixture = createFixture()
    fs.mkdirSync(path.join(fixture.workspace, 'src'), { recursive: true })
    fs.writeFileSync(path.join(fixture.workspace, 'src', 'stable.ts'), 'export const stable = true\n')
    fs.writeFileSync(path.join(fixture.workspace, 'src', 'changing.ts'), 'export const changing = 1\n')
    let fullDiscoveries = 0
    let partialDiscoveries = 0
    class CountingDiscovery extends WorkspaceDiscoveryService {
      override async discover(workspace: string, requestedPaths?: string[]) {
        if (requestedPaths === undefined) fullDiscoveries += 1
        else partialDiscoveries += 1
        return super.discover(workspace, requestedPaths)
      }
    }
    const service = new ProjectIndexService(fixture.database.projectIndex, { discovery: new CountingDiscovery() })
    await service.ensureIndexed(fixture.workspace)
    const stableBefore = service.listFiles(fixture.workspace).find((file) => file.relativePath === 'src/stable.ts')
    fs.writeFileSync(path.join(fixture.workspace, 'src', 'changing.ts'), 'export const changing = 2\n')
    service.enqueueChange({ workspace: fixture.workspace, paths: ['src/changing.ts'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')

    const stableAfter = service.listFiles(fixture.workspace).find((file) => file.relativePath === 'src/stable.ts')
    const changing = service.listFiles(fixture.workspace).find((file) => file.relativePath === 'src/changing.ts')
    expect(fullDiscoveries).toBe(1)
    expect(partialDiscoveries).toBe(1)
    expect(stableAfter?.analyzedHash).toBe(stableBefore?.analyzedHash)
    expect(changing?.analyzedHash).not.toBe(stableBefore?.analyzedHash)
  })

  it('atualiza evidências de configuração sem uma nova travessia completa', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), 'export const main = true\n')
    let fullDiscoveries = 0
    let partialDiscoveries = 0
    class CountingDiscovery extends WorkspaceDiscoveryService {
      override async discover(workspace: string, requestedPaths?: string[]) {
        if (requestedPaths === undefined) fullDiscoveries += 1
        else partialDiscoveries += 1
        return super.discover(workspace, requestedPaths)
      }
    }
    const service = new ProjectIndexService(fixture.database.projectIndex, { discovery: new CountingDiscovery() })
    await service.ensureIndexed(fixture.workspace)
    fs.writeFileSync(path.join(fixture.workspace, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' }, scripts: { test: 'vitest' } }))
    service.enqueueChange({ workspace: fixture.workspace, paths: ['package.json'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')

    expect(fullDiscoveries).toBe(1)
    expect(partialDiscoveries).toBe(2)
    expect(service.listStackEvidence(fixture.workspace)).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'framework', value: 'React' })]))
  })

  it('drena eventos que chegam enquanto a indexação inicial está em andamento', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'changing.ts'), 'export const changing = 1\n')
    class SlowDiscovery extends WorkspaceDiscoveryService {
      override async discover(workspace: string, requestedPaths?: string[]) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        return super.discover(workspace, requestedPaths)
      }
    }
    const service = new ProjectIndexService(fixture.database.projectIndex, { discovery: new SlowDiscovery() })
    const initial = service.ensureIndexed(fixture.workspace)
    fs.writeFileSync(path.join(fixture.workspace, 'changing.ts'), 'export const changing = 2\n')
    service.enqueueChange({ workspace: fixture.workspace, paths: ['changing.ts'], overflow: false })

    await initial

    expect(service.getMetrics()).toMatchObject({ runs: 2, incrementalRuns: 1 })
    expect(service.getStatus(fixture.workspace)).toMatchObject({ kind: 'incremental', status: 'completed' })
  })

  it('registra falha parcial sem impedir o processamento dos demais arquivos', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'good.ts'), 'export function good() {}\n')
    fs.writeFileSync(path.join(fixture.workspace, 'too-large.ts'), `export const tooLarge = '${'x'.repeat(200)}'\n`)
    const service = new ProjectIndexService(fixture.database.projectIndex, { maxParseBytes: 64 })
    await service.ensureIndexed(fixture.workspace)

    const summary = service.getSummary(fixture.workspace)
    expect(summary.indexedFiles).toBe(1)
    expect(summary.failedFiles).toBe(1)
    expect(service.listFiles(fixture.workspace)).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'good.ts', state: 'indexed' }),
      expect.objectContaining({ relativePath: 'too-large.ts', state: 'failed', observedHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]))
  })

  it('permite cancelar uma execução sem descartar entradas já confirmadas', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), 'export const main = true\n')
    class SlowDiscovery extends WorkspaceDiscoveryService {
      override async discover(workspace: string, requestedPaths?: string[]) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return super.discover(workspace, requestedPaths)
      }
    }
    const service = new ProjectIndexService(fixture.database.projectIndex, { discovery: new SlowDiscovery() })
    const run = service.ensureIndexed(fixture.workspace)
    expect(service.cancel(fixture.workspace)).toBe(true)
    await run
    expect(service.getStatus(fixture.workspace)).toEqual(expect.objectContaining({ status: 'cancelled', cancelled: true }))
  })

  it('relocaliza o índice e as validações preservando as chaves compostas', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), 'export const main = true\n')
    const service = new ProjectIndexService(fixture.database.projectIndex)
    await service.ensureIndexed(fixture.workspace)
    const validation: ValidationRun = {
      id: '00000000-0000-4000-8000-000000000001', workspace: fixture.workspace, kind: 'typecheck', command: 'npx', args: ['--no-install', 'tsc'], status: 'passed', exitCode: 0, durationMs: 3, outputSummary: '', artifacts: [], startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: null,
    }
    fixture.database.validation.create(validation)
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-relocated-project-'))
    directories.push(destination)

    fixture.database.relocateWorkspace(fixture.workspace, destination)

    expect(fixture.database.projectIndex.listFiles(destination)).toEqual(expect.arrayContaining([expect.objectContaining({ workspace: destination, relativePath: 'main.ts' })]))
    expect(fixture.database.projectIndex.listSymbols(destination)).toEqual(expect.arrayContaining([expect.objectContaining({ workspace: destination, name: 'main' })]))
    expect(fixture.database.validation.latest(destination)).toEqual(expect.objectContaining({ workspace: destination, id: validation.id }))
    expect(fixture.database.projectIndex.listFiles(fixture.workspace)).toEqual([])
  })
})

function createFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-index-db-'))
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-index-project-'))
  directories.push(userData, workspace)
  const database = new LocalDatabase(userData)
  databases.push(database)
  database.touchWorkspace(workspace)
  return { userData, workspace, database }
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(predicate()).toBe(true)
}
