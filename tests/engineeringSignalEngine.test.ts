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
const workspace = path.resolve(os.tmpdir(), 'signal-engine-workspace')
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
  it('não mantém uma falha histórica como sinal ativo após uma validação comparável passar', async () => {
    const db = create()
    db.createConversation(workspace)
    let runs: ValidationRun[] = [validationRun]
    const projectIndex: EngineeringProjectIndexSource = {
      getSummary: () => summary,
      listFiles: () => [failedFile],
      listImports: () => [importRelation],
    }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => runs }, {
      now: (() => {
        let index = 0
        return () => index++ === 0 ? '2026-09-08T12:03:00.000Z' : '2026-09-08T12:05:00.000Z'
      })(),
      insightService: new EngineeringInsightService(db.engineeringIntelligence),
    })

    await engine.evaluate(workspace)
    const passedRun: ValidationRun = {
      ...validationRun,
      id: 'validation-pass',
      status: 'passed',
      exitCode: 0,
      startedAt: '2026-09-08T12:04:00.000Z',
      completedAt: '2026-09-08T12:04:00.020Z',
      error: null,
    }
    runs = [passedRun, validationRun]
    const current = await engine.evaluate(workspace)

    expect(current.signals.filter((signal) => signal.category === 'testing')).toEqual([])
    expect(db.engineeringIntelligence.listSignals(workspace, 'active').filter((signal) => signal.category === 'testing')).toEqual([])
    expect(db.engineeringIntelligence.listSignals(workspace, 'resolved').some((signal) => signal.category === 'testing')).toBe(true)
    expect(db.engineeringIntelligence.listInsights(workspace, 'active')).toEqual([])
    await engine.dispose()
    db.close()
  })

  it('não resolve uma falha de test quando apenas uma validação de build passa', async () => {
    const db = create()
    db.createConversation(workspace)
    let runs: ValidationRun[] = [validationRun]
    const projectIndex: EngineeringProjectIndexSource = { getSummary: () => ({ ...summary, latestRun: null }), listFiles: () => [], listImports: () => [] }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => runs })

    await engine.evaluate(workspace)
    runs = [{
      ...validationRun,
      id: 'validation-build-pass',
      kind: 'build',
      command: 'npm',
      args: ['run', 'build'],
      status: 'passed',
      exitCode: 0,
      startedAt: '2026-09-08T12:04:00.000Z',
      completedAt: '2026-09-08T12:04:00.020Z',
      error: null,
    }]

    const current = await engine.evaluate(workspace)

    expect(current.snapshot.categories.find((category) => category.category === 'testing')?.status).toBe('assessed')
    expect(db.engineeringIntelligence.listSignals(workspace, 'active').filter((signal) => signal.category === 'testing')).toHaveLength(1)
    expect(db.engineeringIntelligence.listSignals(workspace, 'resolved').filter((signal) => signal.category === 'testing')).toHaveLength(0)
    await engine.dispose()
    db.close()
  })

  it('mantém uma falha nova ativa depois de um passe anterior', async () => {
    const db = create()
    db.createConversation(workspace)
    const passedRun: ValidationRun = { ...validationRun, id: 'validation-pass-first', status: 'passed', exitCode: 0, error: null }
    let runs: ValidationRun[] = [passedRun]
    const projectIndex: EngineeringProjectIndexSource = { getSummary: () => ({ ...summary, latestRun: null }), listFiles: () => [], listImports: () => [] }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => runs }, { now: (() => {
      let index = 0
      return () => index++ === 0 ? '2026-09-08T12:03:00.000Z' : '2026-09-08T12:05:00.000Z'
    })() })

    await engine.evaluate(workspace)
    runs = [{ ...validationRun, id: 'validation-fail-after-pass', startedAt: '2026-09-08T12:04:00.000Z', completedAt: '2026-09-08T12:04:00.020Z' }]
    const current = await engine.evaluate(workspace)

    expect(current.signals.filter((signal) => signal.category === 'testing')).toHaveLength(1)
    expect(db.engineeringIntelligence.listSignals(workspace, 'active').filter((signal) => signal.category === 'testing')).toHaveLength(1)
    await engine.dispose()
    db.close()
  })

  it('mantém histórico, mas não cria um sinal atual a partir de uma validação stale', async () => {
    const db = create()
    db.createConversation(workspace)
    let runs: ValidationRun[] = [validationRun]
    db.workspaceEvidence.record({ workspace, kind: 'validation', sourceId: validationRun.id, startedAt: validationRun.startedAt })
    const projectIndex: EngineeringProjectIndexSource = { getSummary: () => ({ ...summary, latestRun: null }), listFiles: () => [], listImports: () => [] }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => runs }, { workspaceEvidence: db.workspaceEvidence })

    await engine.evaluate(workspace)
    const passedRun: ValidationRun = {
      ...validationRun,
      id: 'validation-stale-pass',
      status: 'passed',
      exitCode: 0,
      startedAt: '2026-09-08T12:04:00.000Z',
      completedAt: '2026-09-08T12:04:00.020Z',
      error: null,
    }
    db.workspaceEvidence.record({ workspace, kind: 'validation', sourceId: passedRun.id, startedAt: passedRun.startedAt })
    db.workspaceEvidence.invalidate(workspace, 'mudança externa durante a avaliação')
    runs = [passedRun]

    const current = await engine.evaluate(workspace)
    const testing = current.snapshot.categories.find((category) => category.category === 'testing')

    expect(testing?.status).toBe('partial')
    expect(testing?.evidence[0]?.validity).toBe('stale')
    expect(current.signals.filter((signal) => signal.category === 'testing')).toEqual([])
    expect(db.engineeringIntelligence.listSignals(workspace, 'active').filter((signal) => signal.category === 'testing')).toHaveLength(1)
    expect(db.engineeringIntelligence.listSignals(workspace, 'resolved').filter((signal) => signal.category === 'testing')).toHaveLength(0)
    await engine.dispose()
    db.close()
  })

  it('não resolve uma falha histórica quando a validação comparável permanece unknown', async () => {
    const db = create()
    db.createConversation(workspace)
    let runs: ValidationRun[] = [validationRun]
    db.workspaceEvidence.record({ workspace, kind: 'validation', sourceId: validationRun.id, startedAt: validationRun.startedAt })
    const projectIndex: EngineeringProjectIndexSource = { getSummary: () => ({ ...summary, latestRun: null }), listFiles: () => [], listImports: () => [] }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => runs }, { workspaceEvidence: db.workspaceEvidence })

    await engine.evaluate(workspace)
    const passedRun: ValidationRun = {
      ...validationRun,
      id: 'validation-unknown-pass',
      status: 'passed',
      exitCode: 0,
      startedAt: '2026-09-08T12:04:00.000Z',
      completedAt: '2026-09-08T12:04:00.020Z',
      error: null,
    }
    db.workspaceEvidence.record({ workspace, kind: 'validation', sourceId: passedRun.id, startedAt: passedRun.startedAt })
    runs = [passedRun]

    const current = await engine.evaluate(workspace)

    expect(current.snapshot.categories.find((category) => category.category === 'testing')?.status).toBe('partial')
    expect(current.signals.filter((signal) => signal.category === 'testing')).toEqual([])
    expect(db.engineeringIntelligence.listSignals(workspace, 'active').filter((signal) => signal.category === 'testing')).toHaveLength(1)
    expect(db.engineeringIntelligence.listSignals(workspace, 'resolved').filter((signal) => signal.category === 'testing')).toHaveLength(0)
    await engine.dispose()
    db.close()
  })

  it('preserva a identidade de um sinal quando somente sua severidade muda', async () => {
    const db = create()
    db.createConversation(workspace)
    let imports = [importRelation]
    const projectIndex: EngineeringProjectIndexSource = {
      getSummary: () => summary,
      listFiles: () => [],
      listImports: () => imports,
    }
    const engine = new EngineeringSignalEngine(db.engineeringIntelligence, projectIndex, { list: () => [] }, { now: (() => {
      let index = 0
      return () => index++ === 0 ? '2026-09-08T12:03:00.000Z' : '2026-09-08T12:05:00.000Z'
    })() })

    const first = await engine.evaluate(workspace)
    imports = Array.from({ length: 10 }, (_, index) => ({ ...importRelation, id: `import-${index}`, sourcePath: `src/app-${index}.ts` }))
    const second = await engine.evaluate(workspace)
    const firstSignal = first.signals.find((signal) => signal.kind === 'unresolved-local-import')
    const secondSignal = second.signals.find((signal) => signal.kind === 'unresolved-local-import')

    expect(firstSignal?.fingerprint).toBe(secondSignal?.fingerprint)
    expect(firstSignal?.severity).toBe('low')
    expect(secondSignal?.severity).toBe('medium')
    expect(db.engineeringIntelligence.listSignals(workspace).filter((signal) => signal.kind === 'unresolved-local-import')).toHaveLength(1)
    await engine.dispose()
    db.close()
  })

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
