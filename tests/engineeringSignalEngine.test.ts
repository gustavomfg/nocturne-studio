import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalDatabase } from '../electron/database/Database'
import { EngineeringSignalEngine, type EngineeringProjectIndexSource, type EngineeringValidationSource } from '../electron/engineering/EngineeringSignalEngine'
import { EngineeringInsightService } from '../electron/engineering/EngineeringInsightService'
import type { ProjectImport, ProjectIndexFile, ProjectIndexSummary, ProjectIndexRun, ValidationRun } from '../shared/codeIntelligence'
import { removeTestDirectory } from './helpers/platform'

const directories: string[] = []
const sourceHash = 'a'.repeat(64)
const workspace = '/tmp/signal-engine-workspace'
const projectRun: ProjectIndexRun = {
  id: 'project-run-1', workspace, indexVersion: 1, kind: 'initial', status: 'completed', phase: 'completed',
  totalFiles: 2, processedFiles: 1, failedFiles: 1, unsupportedFiles: 0, pendingFiles: 0,
  startedAt: '2026-09-08T12:00:00.000Z', updatedAt: '2026-09-08T12:01:00.000Z', completedAt: '2026-09-08T12:01:00.000Z', error: null,
}
const failedFile: ProjectIndexFile = {
  workspace, relativePath: 'src/broken.ts', classification: 'source', language: 'typescript', extension: '.ts', size: 10,
  mtimeMs: 1, ctimeMs: 1, mode: 0o644, observedHash: sourceHash, analyzedHash: null, state: 'failed', excluded: false,
  exclusionReason: null, parserId: 'typescript', parserVersion: '1', error: 'Parser failed', discoveredAt: projectRun.startedAt, analyzedAt: null,
}
const importRelation: ProjectImport = {
  id: 'import-1', workspace, sourcePath: 'src/app.ts', sourceHash, specifier: './missing', targetPath: null, targetHash: null,
  kind: 'named', importedNames: ['missing'], location: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 20 }, resolution: 'unresolved',
}
const summary: ProjectIndexSummary = {
  workspace, indexVersion: 1, latestRun: projectRun, files: 2, indexedFiles: 1, failedFiles: 1, unsupportedFiles: 0,
  symbols: 1, imports: 1, exports: 0, stack: null,
}
const validationRun: ValidationRun = {
  id: 'validation-1', workspace, kind: 'test', command: 'npm', args: ['test'], status: 'failed', exitCode: 1,
  durationMs: 20, outputSummary: 'bounded summary', artifacts: [], startedAt: '2026-09-08T12:02:00.000Z', completedAt: '2026-09-08T12:02:00.020Z', error: 'O comando terminou com exit code 1.',
}

const create = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-engine-signal-test-'))
  directories.push(directory)
  return new LocalDatabase(directory)
}

afterEach(() => {
  for (const directory of directories.splice(0)) removeTestDirectory(directory)
})

describe('EngineeringSignalEngine', () => {
  it('calcula sinais determinísticos com proveniência e não duplica avaliações iguais', async () => {
    const db = create()
    db.createConversation(workspace)
    const projectIndex: EngineeringProjectIndexSource = {
      getSummary: () => summary,
      listFiles: () => [failedFile],
      listImports: () => [importRelation],
    }
    const validation: EngineeringValidationSource = { list: () => [validationRun] }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, validation, { now: () => '2026-09-08T12:03:00.000Z', insightService: new EngineeringInsightService(db.engineeringIntelligence) })

    const first = await engine.evaluate(workspace)
    const second = await engine.evaluate(workspace)

    expect(first.signals.map((signal) => signal.category)).toEqual(expect.arrayContaining(['architecture', 'testing']))
    expect(first.signals.every((signal) => signal.confidence >= 0 && signal.evidence.length > 0)).toBe(true)
    expect(first.snapshot.categories.find((category) => category.category === 'security')).toMatchObject({ status: 'not-assessed', score: null })
    expect(first.insights).toHaveLength(1)
    expect(db.engineeringIntelligence.listInsights(workspace)).toHaveLength(1)
    expect(second.snapshot.id).toBe(first.snapshot.id)
    expect(db.engineeringIntelligence.listSnapshots(workspace)).toHaveLength(1)
    expect(db.engineeringIntelligence.listSignals(workspace)).toHaveLength(3)
    await engine.dispose()
    db.close()
  })

  it('separa falha do projeto de indisponibilidade do ambiente', async () => {
    const db = create()
    db.createConversation(workspace)
    const blocked: ValidationRun = {
      ...validationRun,
      id: 'validation-blocked',
      status: 'blocked',
      exitCode: null,
      error: 'Nenhum comando de test foi identificado nas evidências do stack.',
    }
    const projectIndex: EngineeringProjectIndexSource = { getSummary: () => ({ ...summary, latestRun: null }), listFiles: () => [], listImports: () => [] }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => [blocked] })

    const result = await engine.evaluate(workspace)

    expect(result.snapshot.categories.find((category) => category.category === 'testing')?.status).toBe('partial')
    expect(result.snapshot.categories.find((category) => category.category === 'developer-experience')?.status).toBe('partial')
    expect(result.signals.every((signal) => signal.category !== 'testing')).toBe(true)
    expect(result.signals.some((signal) => signal.category === 'developer-experience')).toBe(true)
    await engine.dispose()
    db.close()
  })
})
