import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { migrateDatabase, migrations } from '../electron/database/migrations'
import { WorkspaceDiscoveryService } from '../electron/project-index/WorkspaceDiscoveryService'
import { ProjectIndexService } from '../electron/project-index/ProjectIndexService'
import { ParserRegistry } from '../electron/project-index/ParserAdapter'
import { TypeScriptParserAdapter } from '../electron/project-index/TypeScriptParserAdapter'
import type { ValidationRun } from '../shared/codeIntelligence'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Project Index', () => {
  it('isola relações derivadas entre dois workspaces idênticos no mesmo banco', async () => {
    const fixture = createFixture()
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-index-clone-'))
    directories.push(clone)
    for (const workspace of [fixture.workspace, clone]) {
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
      fs.writeFileSync(path.join(workspace, 'src', 'util.ts'), 'export const value = 1\n')
      fs.writeFileSync(path.join(workspace, 'src', 'main.ts'), "import { value } from './util'\nexport const main = value\n")
      fixture.database.touchWorkspace(workspace)
    }
    const service = new ProjectIndexService(fixture.database.projectIndex)

    await service.ensureIndexed(fixture.workspace)
    await service.ensureIndexed(clone)

    expect(service.getSummary(fixture.workspace)).toMatchObject({ indexedFiles: 2, failedFiles: 0, imports: 1 })
    expect(service.getSummary(clone)).toMatchObject({ indexedFiles: 2, failedFiles: 0, imports: 1 })
    const first = service.listImports(fixture.workspace)[0]
    const second = service.listImports(clone)[0]
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second?.id).not.toBe(first?.id)
    const cloneRelationId = second?.id
    fs.writeFileSync(path.join(fixture.workspace, 'src', 'main.ts'), "import { value } from './util'\nexport const main = value + 1\n")
    await service.startManual(fixture.workspace)
    expect(service.listImports(clone)[0]?.id).toBe(cloneRelationId)
    fixture.database.removeWorkspace(fixture.workspace)
    expect(service.listImports(clone)[0]?.id).toBe(cloneRelationId)
  })

  it('migra a chave das relações sem perder dados e aceita o mesmo id em workspaces distintos', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-index-migration-'))
    directories.push(userData)
    const firstWorkspace = path.join(userData, 'first')
    const secondWorkspace = path.join(userData, 'second')
    fs.mkdirSync(firstWorkspace)
    fs.mkdirSync(secondWorkspace)
    const databasePath = path.join(userData, 'nocturne.db')
    const legacy = new Sqlite(databasePath)
    migrateDatabase(legacy, 0, migrations.filter((migration) => migration.version <= 30))
    const now = new Date().toISOString()
    const addWorkspace = (database: Sqlite.Database, workspace: string) => {
      database.prepare('INSERT INTO workspaces(path,name,authorized,created_at,last_opened_at) VALUES(?,?,1,?,?)').run(workspace, path.basename(workspace), now, now)
      database.prepare(`INSERT INTO project_index_files(
        workspace,relative_path,classification,language,extension,size,mtime_ms,ctime_ms,mode,
        observed_hash,analyzed_hash,state,excluded,exclusion_reason,parser_id,parser_version,error,discovered_at,analyzed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        workspace, 'main.ts', 'source', 'TypeScript', '.ts', 1, 1, 1, 0o644,
        'a'.repeat(64), 'a'.repeat(64), 'indexed', 0, null, 'typescript', '1', null, now, now,
      )
    }
    addWorkspace(legacy, firstWorkspace)
    legacy.prepare(`INSERT INTO project_index_imports(
      id,workspace,source_path,source_hash,specifier,target_path,target_hash,kind,imported_names,
      start_line,start_column,end_line,end_column,resolution
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'import-same-id', firstWorkspace, 'main.ts', 'a'.repeat(64), './util', null, null, 'named', '[]', 1, 1, 1, 10, 'unresolved',
    )
    legacy.prepare(`INSERT INTO project_index_exports(
      id,workspace,source_path,source_hash,name,kind,target_path,target_hash,
      start_line,start_column,end_line,end_column
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'export-same-id', firstWorkspace, 'main.ts', 'a'.repeat(64), 'value', 'named', null, null, 1, 1, 1, 10,
    )
    legacy.pragma('user_version = 30')
    legacy.close()

    const migrated = new LocalDatabase(userData)
    databases.push(migrated)
    expect(migrated.projectIndex.listImports(firstWorkspace)).toHaveLength(1)
    migrated.close()

    const current = new Sqlite(databasePath)
    addWorkspace(current, secondWorkspace)
    current.prepare(`INSERT INTO project_index_imports(
      id,workspace,source_path,source_hash,specifier,target_path,target_hash,kind,imported_names,
      start_line,start_column,end_line,end_column,resolution
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'import-same-id', secondWorkspace, 'main.ts', 'a'.repeat(64), './util', null, null, 'named', '[]', 1, 1, 1, 10, 'unresolved',
    )
    current.prepare(`INSERT INTO project_index_exports(
      id,workspace,source_path,source_hash,name,kind,target_path,target_hash,
      start_line,start_column,end_line,end_column
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'export-same-id', secondWorkspace, 'main.ts', 'a'.repeat(64), 'value', 'named', null, null, 1, 1, 1, 10,
    )
    current.close()
    const reopened = new LocalDatabase(userData)
    databases.push(reopened)
    expect(reopened.projectIndex.listImports(firstWorkspace)).toHaveLength(1)
    expect(reopened.projectIndex.listImports(secondWorkspace)).toHaveLength(1)
    expect(reopened.projectIndex.listExports(firstWorkspace)).toHaveLength(1)
    expect(reopened.projectIndex.listExports(secondWorkspace)).toHaveLength(1)
  })

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

  it('recalcula o importador quando um alvo antes ausente é criado', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), "import { missing } from './missing'\nexport const main = missing\n")
    const processed: string[] = []
    const service = new ProjectIndexService(fixture.database.projectIndex, { onFileProcessed: (event) => processed.push(event.relativePath) })
    await service.ensureIndexed(fixture.workspace)
    expect(service.listImports(fixture.workspace, 'main.ts')).toEqual([
      expect.objectContaining({ resolution: 'unresolved', targetPath: null }),
    ])

    fs.writeFileSync(path.join(fixture.workspace, 'missing.ts'), 'export const missing = true\n')
    processed.length = 0
    service.enqueueChange({ workspace: fixture.workspace, paths: ['missing.ts'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')

    expect(processed).toEqual(expect.arrayContaining(['missing.ts', 'main.ts']))
    expect(service.listImports(fixture.workspace, 'main.ts')).toEqual([
      expect.objectContaining({ resolution: 'local', targetPath: 'missing.ts', targetHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])
  })

  it('recalcula o importador quando um alvo resolvido é removido', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'dependency.ts'), 'export const dependency = true\n')
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), "import { dependency } from './dependency'\nexport const main = dependency\n")
    const service = new ProjectIndexService(fixture.database.projectIndex)
    await service.ensureIndexed(fixture.workspace)
    expect(service.listImports(fixture.workspace, 'main.ts')).toEqual([
      expect.objectContaining({ resolution: 'local', targetPath: 'dependency.ts' }),
    ])

    fs.rmSync(path.join(fixture.workspace, 'dependency.ts'))
    service.enqueueChange({ workspace: fixture.workspace, paths: ['dependency.ts'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')

    expect(service.listImports(fixture.workspace, 'main.ts')).toEqual([
      expect.objectContaining({ resolution: 'unresolved', targetPath: null, targetHash: null }),
    ])
  })

  it('recalcula a relação quando o alvo é renomeado', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'old.ts'), 'export const value = true\n')
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), "import { value } from './old'\nexport const main = value\n")
    const service = new ProjectIndexService(fixture.database.projectIndex)
    await service.ensureIndexed(fixture.workspace)
    fs.renameSync(path.join(fixture.workspace, 'old.ts'), path.join(fixture.workspace, 'new.ts'))
    service.enqueueChange({ workspace: fixture.workspace, paths: ['old.ts', 'new.ts'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')

    expect(service.listImports(fixture.workspace, 'main.ts')).toEqual([
      expect.objectContaining({ resolution: 'unresolved', targetPath: null, targetHash: null }),
    ])

    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), "import { value } from './new'\nexport const main = value\n")
    service.enqueueChange({ workspace: fixture.workspace, paths: ['main.ts'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')
    expect(service.listImports(fixture.workspace, 'main.ts')).toEqual([
      expect.objectContaining({ resolution: 'local', targetPath: 'new.ts' }),
    ])
  })

  it('atualiza o hash do alvo sem reprocessar um importer inalterado', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'dependency.ts'), 'export const dependency = 1\n')
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), "import { dependency } from './dependency'\nexport const main = dependency\n")
    const processed: string[] = []
    const service = new ProjectIndexService(fixture.database.projectIndex, { onFileProcessed: (event) => processed.push(event.relativePath) })
    await service.ensureIndexed(fixture.workspace)
    const before = service.listImports(fixture.workspace, 'main.ts')[0]!
    fs.writeFileSync(path.join(fixture.workspace, 'dependency.ts'), 'export const dependency = 2\n')
    processed.length = 0
    service.enqueueChange({ workspace: fixture.workspace, paths: ['dependency.ts'], overflow: false })
    await waitFor(() => service.getStatus(fixture.workspace)?.kind === 'incremental' && service.getStatus(fixture.workspace)?.status === 'completed')

    const after = service.listImports(fixture.workspace, 'main.ts')[0]!
    expect(after.targetPath).toBe('dependency.ts')
    expect(after.targetHash).not.toBe(before.targetHash)
    expect(processed).toEqual(expect.arrayContaining(['dependency.ts']))
    expect(processed.filter((path) => path === 'main.ts')).toHaveLength(0)
  })

  it('não reutiliza análise quando bytes mudam mantendo metadados aparentes', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const oldName = 1\n')
    const service = new ProjectIndexService(fixture.database.projectIndex)
    await service.ensureIndexed(fixture.workspace)
    const original = fs.statSync(target)

    fs.writeFileSync(target, 'export const newName = 1\n')
    fs.utimesSync(target, original.atime, original.mtime)
    await service.startManual(fixture.workspace)

    expect(service.listSymbols(fixture.workspace).map((symbol) => symbol.name)).toContain('newName')
    expect(service.listSymbols(fixture.workspace).map((symbol) => symbol.name)).not.toContain('oldName')
  })

  it('reprocessa arquivos quando a versão do parser muda sem alteração nos bytes', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const main = true\n')
    const first = new TypeScriptParserAdapter()
    const service = new ProjectIndexService(fixture.database.projectIndex, { parserRegistry: new ParserRegistry([first]) })
    await service.ensureIndexed(fixture.workspace)
    expect(service.getFile(fixture.workspace, 'main.ts')?.parserVersion).toBe(first.version)

    const second = new TypeScriptParserAdapter()
    Object.defineProperty(second, 'version', { value: `${second.version}-revision-2` })
    const restarted = new ProjectIndexService(fixture.database.projectIndex, { parserRegistry: new ParserRegistry([second]) })
    await restarted.startManual(fixture.workspace)

    expect(restarted.getFile(fixture.workspace, 'main.ts')?.parserVersion).toBe(`${second.version}`)
  })

  it('não transforma uma reconciliação truncada em prova de exclusão', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'first.ts'), 'export const first = true\n')
    fs.writeFileSync(path.join(fixture.workspace, 'second.ts'), 'export const second = true\n')
    const initial = new ProjectIndexService(fixture.database.projectIndex)
    await initial.ensureIndexed(fixture.workspace)

    const truncated = new ProjectIndexService(fixture.database.projectIndex, {
      discovery: new WorkspaceDiscoveryService({ maxTraversalEntries: 1 }),
    })
    await truncated.startManual(fixture.workspace)

    expect(truncated.getStatus(fixture.workspace)).toMatchObject({ error: expect.stringContaining('trabalho da travessia') })
    expect(truncated.getFile(fixture.workspace, 'first.ts')).toBeTruthy()
    expect(truncated.getFile(fixture.workspace, 'second.ts')).toBeTruthy()
  })

  it('encontra símbolos relevantes depois dos primeiros cem registros', async () => {
    const fixture = createFixture()
    const source = Array.from({ length: 120 }, (_, index) => `export const symbol${index.toString().padStart(3, '0')} = ${index}`).join('\n')
    fs.writeFileSync(path.join(fixture.workspace, 'symbols.ts'), `${source}\nexport const targetAfterLimit = true\n`)
    const service = new ProjectIndexService(fixture.database.projectIndex)
    await service.ensureIndexed(fixture.workspace)

    const context = service.buildAiContext(fixture.workspace, 'targetAfterLimit')

    expect(context?.selections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: expect.stringContaining('targetAfterLimit') }),
    ]))
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
