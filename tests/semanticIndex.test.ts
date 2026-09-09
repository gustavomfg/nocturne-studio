import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { ProjectIndexService } from '../electron/project-index/ProjectIndexService'
import { SemanticIndexService } from '../electron/semantic-index/SemanticIndexService'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Semantic Index', () => {
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
    const projectIndex = new ProjectIndexService(fixture.database.projectIndex, {
      onStatus: (status) => {
        if (['completed', 'failed', 'cancelled'].includes(status.status)) void semantic?.ensureIndexed(fixture.workspace)
      },
    })
    semantic = new SemanticIndexService(fixture.database.semanticIndex, { projectIndex })
    await projectIndex.ensureIndexed(fixture.workspace)
    await semantic.ensureIndexed(fixture.workspace)
    const stableBefore = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'stable.ts')[0]
    const changingBefore = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'changing.ts')[0]

    fs.writeFileSync(path.join(fixture.workspace, 'changing.ts'), 'export const changing = 2\n')
    projectIndex.enqueueChange({ workspace: fixture.workspace, paths: ['changing.ts'], overflow: false })
    semantic.enqueuePaths(fixture.workspace, ['changing.ts'])
    await waitFor(() => projectIndex.getStatus(fixture.workspace)?.kind === 'incremental' && projectIndex.getStatus(fixture.workspace)?.status === 'completed')
    await waitFor(() => semantic?.getStatus(fixture.workspace)?.kind === 'incremental' && semantic?.getStatus(fixture.workspace)?.status === 'completed')

    const stableAfter = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'stable.ts')[0]
    const changingAfter = fixture.database.semanticIndex.listFileUnits(fixture.workspace, 'changing.ts')[0]
    expect(stableAfter).toEqual(stableBefore)
    expect(changingAfter?.sourceHash).not.toBe(changingBefore?.sourceHash)
    expect(semantic.getMetrics()).toMatchObject({ runs: 2, incrementalRuns: 1 })
    await semantic.dispose()
  })
})

function createFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-semantic-db-'))
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-semantic-project-'))
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
