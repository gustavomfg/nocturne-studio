import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { ProjectIndexService } from '../electron/project-index/ProjectIndexService'
import { SemanticIndexService } from '../electron/semantic-index/SemanticIndexService'
import { SemanticRetrievalService } from '../electron/semantic-index/SemanticRetrievalService'
import { canonicalTestPath, removeTestDirectory } from './helpers/platform'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) removeTestDirectory(directory)
})

describe('Semantic Index', () => {
  it('não apresenta uma unidade lexical derivada de hash antigo como atual', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const oldTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)

    const oldUnit = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]
    expect(oldUnit?.sourceHash).toBeTruthy()
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex)
    await expect(retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })).resolves.toEqual([
      expect.objectContaining({ provenance: expect.objectContaining({ validity: 'current', potentiallyOutdated: false }) }),
    ])
    fs.writeFileSync(target, 'export const newTerm = true\n')
    const current = projectIndex.getFile(fixture.workspace, 'main.ts')!
    const newHash = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    fixture.database.projectIndex.upsertFile({ ...current, observedHash: newHash, analyzedHash: newHash, state: 'indexed' })

    await expect(retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })).resolves.toEqual([])
    await semantic.dispose()
  })

  it('não apresenta vetor antigo quando o arquivo muda durante a consulta', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const vectorTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const unit = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]!
    const embeddingSpace = { providerId: 'local', modelId: 'test', modelVersion: '1', dimensions: 2 }
    fixture.database.semanticIndex.replaceFileUnits(fixture.workspace, 'main.ts', [{
      ...unit,
      status: 'indexed',
      embeddingSpace,
      embedding: [1, 0],
    }])

    let mutated = false
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex, {
      resolve: async () => ({ space: embeddingSpace, remote: false, remoteAllowed: true }),
      embed: async () => {
        if (!mutated) {
          mutated = true
          fs.writeFileSync(target, 'export const replacementTerm = true\n')
        }
        return [[1, 0]]
      },
    })

    await expect(retrieval.search({ workspace: fixture.workspace, query: 'vectorTerm', limit: 10 })).resolves.toEqual([])
    await semantic.dispose()
  })

  it('não usa vetor quando o Project Index já conhece outro hash estrutural', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const vectorOnlyTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const unit = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]!
    const embeddingSpace = { providerId: 'local', modelId: 'test', modelVersion: '1', dimensions: 2 }
    fixture.database.semanticIndex.replaceFileUnits(fixture.workspace, 'main.ts', [{ ...unit, status: 'indexed', embeddingSpace, embedding: [1, 0] }])
    fs.writeFileSync(target, 'export const changedVectorTerm = true\n')
    const current = projectIndex.getFile(fixture.workspace, 'main.ts')!
    const newHash = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    fixture.database.projectIndex.upsertFile({ ...current, observedHash: newHash, analyzedHash: newHash, state: 'indexed' })
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex, {
      resolve: async () => ({ space: embeddingSpace, remote: false, remoteAllowed: true }),
      embed: async () => [[1, 0]],
    })

    await expect(retrieval.search({ workspace: fixture.workspace, query: 'qualquer', limit: 10 })).resolves.toEqual([])
    await semantic.dispose()
  })

  it('descarta a unidade antiga quando o arquivo é removido e recriado', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const oldTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex)

    await expect(retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })).resolves.toHaveLength(1)
    fs.rmSync(target)
    await expect(retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })).resolves.toEqual([])
    fs.writeFileSync(target, 'export const replacementTerm = true\n')
    await expect(retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })).resolves.toEqual([])
    await semantic.dispose()
  })

  it('não usa unidade semântica enquanto o Project Index conhece estado pending', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const pendingTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex)

    fs.writeFileSync(target, 'export const refreshedTerm = true\n')
    const current = projectIndex.getFile(fixture.workspace, 'main.ts')!
    const observedHash = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    fixture.database.projectIndex.upsertFile({ ...current, observedHash, state: 'pending' })

    await expect(retrieval.search({ workspace: fixture.workspace, query: 'pendingTerm', limit: 10 })).resolves.toEqual([])
    await semantic.dispose()
  })

  it('não expande dependências a partir de uma unidade lexical stale', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, "import { dependency } from './dependency'\nexport const oldTerm = dependency\n")
    fs.writeFileSync(path.join(fixture.workspace, 'dependency.ts'), 'export const dependency = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex)

    const initial = await retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })
    expect(initial.map((result) => result.unit.relativePath)).toContain('dependency.ts')
    fs.writeFileSync(target, "import { dependency } from './dependency'\nexport const newTerm = dependency\n")
    const current = projectIndex.getFile(fixture.workspace, 'main.ts')!
    const observedHash = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    fixture.database.projectIndex.upsertFile({ ...current, observedHash, analyzedHash: observedHash, state: 'indexed' })

    const stale = await retrieval.search({ workspace: fixture.workspace, query: 'oldTerm', limit: 10 })
    expect(stale).toEqual([])
    await semantic.dispose()
  })

  it('preserva unidades lexicais quando um arquivo falha e mantém o restante utilizável', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'good.ts'), 'export function good() { return true }\n')
    fs.writeFileSync(path.join(fixture.workspace, 'too-large.ts'), `export const tooLarge = '${'x'.repeat(200)}'\n`)
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex, { maxParseBytes: 64 })
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })

    await semantic.ensureIndexed(fixture.workspace)

    expect(fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'good.ts')).toEqual([
      expect.objectContaining({ status: 'lexical-only', sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), relativePath: 'good.ts' }),
    ])
    expect(semantic.getSummary(fixture.workspace)).toMatchObject({ files: 1, units: 1, lexicalOnlyUnits: 1 })
    expect(semantic.getStatus(fixture.workspace)).toMatchObject({ status: 'completed', processedFiles: 2, failedFiles: 1 })
    expect(semantic.getMetrics()).toMatchObject({ runs: 1, filesProcessed: 2, failedFiles: 1, partialFailures: 1 })
    await semantic.dispose()
  })

  it('persiste vetores no espaço configurado e pode cancelar durante o embedding', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), 'export function main() { return true }\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const embeddings = {
      resolve: async () => ({ space: { providerId: 'local', modelId: 'embed-code', modelVersion: '1', dimensions: 2 }, remote: false, remoteAllowed: true }),
      embed: async (_workspace: string, _space: { providerId: string; modelId: string; modelVersion: string | null; dimensions: number }, inputs: readonly string[], signal: AbortSignal) => {
        if (signal.aborted) throw new Error('cancelled')
        return inputs.map(() => [0.25, 0.75])
      },
    }
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex, embeddings })
    await semantic.ensureIndexed(fixture.workspace)
    const indexed = fixture.database.semanticIndex.listIndexedEmbeddings(fixture.workspace, { providerId: 'local', modelId: 'embed-code', modelVersion: '1', dimensions: 2 })
    expect(indexed).toHaveLength(1)
    expect(indexed[0]?.embedding).toEqual([0.25, 0.75])

    const failedSemantic = new SemanticIndexService(fixture.database.semanticIndex, {
      projectIndex,
      embeddings: {
        resolve: async () => ({ space: { providerId: 'local', modelId: 'failed-embed', modelVersion: null, dimensions: 2 }, remote: false, remoteAllowed: true }),
        embed: async () => { throw new Error('Provider indisponível') },
      },
    })
    await failedSemantic.ensureIndexed(fixture.workspace)
    await failedSemantic.ensureIndexed(fixture.workspace)
    expect(failedSemantic.getMetrics()).toMatchObject({ runs: 1, lexicalOnlyUnits: 1 })
    expect(fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]).toMatchObject({ status: 'lexical-only', error: expect.stringContaining('embedding:local/failed-embed') })
    await failedSemantic.dispose()

    const slowSemantic = new SemanticIndexService(fixture.database.semanticIndex, {
      projectIndex,
      embeddings: {
        resolve: async () => ({ space: { providerId: 'local', modelId: 'slow-embed', modelVersion: null, dimensions: 2 }, remote: false, remoteAllowed: true }),
        embed: async (_workspace, _space, _inputs, signal) => await new Promise<readonly (readonly number[])[]>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
          void resolve
        }),
      },
    })
    const run = slowSemantic.ensureIndexed(fixture.workspace)
    await waitFor(() => slowSemantic.getStatus(fixture.workspace)?.status === 'running')
    expect(slowSemantic.cancel(fixture.workspace)).toBe(true)
    await run
    expect(slowSemantic.getStatus(fixture.workspace)).toMatchObject({ status: 'cancelled', cancelled: true })
    await slowSemantic.dispose()
    await semantic.dispose()
  })

  it('reprocessa somente o caminho alterado quando o Project Index emite um evento incremental', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'stable.ts'), 'export const stable = true\n')
    fs.writeFileSync(path.join(fixture.workspace, 'changing.ts'), 'export const changing = 1\n')
    let semantic: SemanticIndexService | undefined
    let forwardProjectEvents = false
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex, {
      onStatus: (status) => {
        if (['completed', 'failed', 'cancelled'].includes(status.status)) void semantic?.ensureIndexed(fixture.workspace)
      },
      onFileProcessed: (event) => { if (forwardProjectEvents) semantic?.enqueueFile(event) },
    })
    semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await projectIndex.ensureIndexed(fixture.workspace)
    await semantic.ensureIndexed(fixture.workspace)
    forwardProjectEvents = true
    const stableBefore = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'stable.ts')[0]
    const changingBefore = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'changing.ts')[0]

    fs.writeFileSync(path.join(fixture.workspace, 'changing.ts'), 'export const changing = 2\n')
    projectIndex.enqueueChange({ workspace: fixture.workspace, paths: ['changing.ts'], overflow: false })
    await waitFor(() => projectIndex.getStatus(fixture.workspace)?.kind === 'incremental' && projectIndex.getStatus(fixture.workspace)?.status === 'completed')
    await waitFor(() => semantic?.getStatus(fixture.workspace)?.kind === 'incremental' && semantic?.getStatus(fixture.workspace)?.status === 'completed')

    const stableAfter = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'stable.ts')[0]
    const changingAfter = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'changing.ts')[0]
    expect(stableAfter).toEqual(stableBefore)
    expect(changingAfter?.sourceHash).not.toBe(changingBefore?.sourceHash)
    expect(semantic.getMetrics()).toMatchObject({ runs: 2, incrementalRuns: 1 })
    await semantic.dispose()
  })

  it('não deixa filtros estruturais serem ignorados por candidatos vetoriais', async () => {
    const fixture = createFixture()
    const target = path.join(fixture.workspace, 'main.ts')
    fs.writeFileSync(target, 'export const vectorOnlyTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const unit = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]!
    const embeddingSpace = { providerId: 'local', modelId: 'test', modelVersion: '1', dimensions: 2 }
    fixture.database.semanticIndex.replaceFileUnits(fixture.workspace, 'main.ts', [{ ...unit, status: 'indexed', embeddingSpace, embedding: [1, 0] }])
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex, {
      resolve: async () => ({ space: embeddingSpace, remote: false, remoteAllowed: true }),
      embed: async () => [[1, 0]],
    })

    await expect(retrieval.search({ workspace: fixture.workspace, query: 'vectorOnlyTerm', filters: { symbols: ['not-this-symbol'] }, limit: 10 })).resolves.toEqual([])
    await semantic.dispose()
  })

  it('retorna o melhor vetor mesmo quando ele está depois de duzentos registros', async () => {
    const fixture = createFixture()
    for (let index = 0; index < 201; index += 1) {
      const name = `file-${index.toString().padStart(3, '0')}.ts`
      fs.writeFileSync(path.join(fixture.workspace, name), `export const value${index} = ${index}\n`)
    }
    fs.writeFileSync(path.join(fixture.workspace, 'zz-relevant.ts'), 'export const valueRelevant = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const embeddingSpace = { providerId: 'local', modelId: 'test', modelVersion: '1', dimensions: 2 }
    const relevantPath = 'zz-relevant.ts'
    for (const file of projectIndex.listFiles(fixture.workspace)) {
      const unit = fixture.database.semanticIndex.listFileUnits(fixture.workspace, file.relativePath)[0]
      if (!unit) continue
      fixture.database.semanticIndex.replaceFileUnits(fixture.workspace, file.relativePath, [{ ...unit, status: 'indexed', embeddingSpace, embedding: file.relativePath === relevantPath ? [1, 0] : [0, 1] }])
    }
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex, {
      resolve: async () => ({ space: embeddingSpace, remote: false, remoteAllowed: true }),
      embed: async () => [[1, 0]],
    })

    const results = await retrieval.search({ workspace: fixture.workspace, query: 'unmatched-query', limit: 1 })

    expect(results[0]?.unit.relativePath).toBe(relevantPath)
    expect(results[0]?.scores.vector).toBe(1)
    await semantic.dispose()
  }, 60_000)

  it('mantém dependência-only como reforço abaixo da evidência primária', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), "import { dependency } from './dependency'\nexport const mainTerm = dependency\n")
    fs.writeFileSync(path.join(fixture.workspace, 'dependency.ts'), 'export const dependency = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const retrieval = new SemanticRetrievalService(fixture.database.semanticIndex, projectIndex)

    const results = await retrieval.search({ workspace: fixture.workspace, query: 'mainTerm', limit: 10 })
    const dependency = results.find((result) => result.unit.relativePath === 'dependency.ts')
    const primary = results.find((result) => result.unit.relativePath === 'main.ts')

    expect(primary?.scores.lexical).toBeGreaterThan(0)
    expect(dependency?.scores.dependency).toBe(1)
    expect(dependency?.scores.final).toBe(0.1)
    expect(primary?.scores.final).toBeGreaterThan(dependency?.scores.final ?? 1)
    await semantic.dispose()
  })

  it('reconstrói unidades persistidas quando a estratégia de localização muda', async () => {
    const fixture = createFixture()
    fs.writeFileSync(path.join(fixture.workspace, 'main.ts'), 'export const locationTerm = true\n')
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex)
    await projectIndex.ensureIndexed(fixture.workspace)
    const semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await semantic.ensureIndexed(fixture.workspace)
    const current = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]!
    fixture.database.semanticIndex.replaceFileUnits(fixture.workspace, 'main.ts', [{ ...current, chunkStrategyVersion: 'symbols-v1' }])

    await semantic.ensureIndexed(fixture.workspace)

    expect(fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'main.ts')[0]?.chunkStrategyVersion).toBe('symbols-v2')
    await semantic.dispose()
  })
})

function createFixture() {
  const userData = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-semantic-db-')))
  const workspace = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-semantic-project-')))
  directories.push(userData, workspace)
  const database = new LocalDatabase(userData)
  databases.push(database)
  database.touchWorkspace(workspace)
  return { userData, workspace, database }
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 10_000
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(predicate()).toBe(true)
}
