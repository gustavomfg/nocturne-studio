import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import {
  ENGINEERING_HEALTH_POLICY_VERSION,
  engineeringHealthCategories,
  type EngineeringEvidence,
  type EngineeringHealthSnapshot,
  type EngineeringSignal,
} from '../shared/engineeringIntelligence'
import { removeTestDirectory } from './helpers/platform'

const directories: string[] = []
const hash = 'a'.repeat(64)
const create = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-engineering-test-'))
  directories.push(directory)
  return new LocalDatabase(directory)
}
const evidence: EngineeringEvidence = {
  id: 'evidence-architecture-1',
  source: 'project-index-file',
  sourceId: 'project-file-1',
  relativePath: 'src/app.ts',
  sourceHash: hash,
  detail: 'Arquivo indexado pelo Project Index.',
  observedAt: '2026-09-08T12:00:00.000Z',
}
const signal = (overrides: Partial<EngineeringSignal> = {}): EngineeringSignal => ({
  id: 'signal-architecture-1',
  workspace: '/tmp/engineering-workspace',
  category: 'architecture',
  kind: 'example-deterministic-signal',
  title: 'Sinal arquitetural de teste',
  description: 'Sinal determinístico usado para validar a persistência.',
  severity: 'medium',
  confidence: 90,
  evidence: [evidence],
  metric: { name: 'affectedFiles', value: 1, unit: 'files' },
  source: 'deterministic',
  policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
  detectedAt: '2026-09-08T12:00:00.000Z',
  fingerprint: hash,
  status: 'active',
  firstSeenAt: '2026-09-08T12:00:00.000Z',
  lastSeenAt: '2026-09-08T12:00:00.000Z',
  resolvedAt: null,
  ...overrides,
})
const snapshot = (overrides: Partial<EngineeringHealthSnapshot> = {}): EngineeringHealthSnapshot => ({
  id: 'snapshot-1',
  workspace: '/tmp/engineering-workspace',
  policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
  evaluatedAt: '2026-09-08T12:00:00.000Z',
  previousSnapshotId: null,
  sources: {
    projectIndexRunId: 'project-run-1',
    semanticIndexRunId: null,
    validationRunIds: [],
    executionIds: [],
    changeSetIds: [],
  },
  categories: engineeringHealthCategories.map((category) => ({
    category,
    status: category === 'architecture' ? 'assessed' as const : 'not-assessed' as const,
    score: null,
    coverage: { available: category === 'architecture' ? 1 : 0, expected: null, percent: null },
    signalIds: category === 'architecture' ? ['signal-architecture-1'] : [],
    evidence: category === 'architecture' ? [evidence] : [],
    evaluatedAt: '2026-09-08T12:00:00.000Z',
  })),
  signalFingerprints: [hash],
  signalStates: [{ fingerprint: hash, category: 'architecture', severity: 'medium', status: 'active' }],
  stateFingerprint: hash,
  ...overrides,
})

afterEach(() => {
  for (const directory of directories.splice(0)) removeTestDirectory(directory)
})

describe('Engineering Intelligence Foundation', () => {
  it('persiste sinais, evita duplicação por fingerprint e preserva a primeira observação', () => {
    const db = create()
    const workspace = '/tmp/engineering-workspace'
    db.createConversation(workspace)

    db.engineeringIntelligence.saveEvaluation([signal()], snapshot())
    db.engineeringIntelligence.saveEvaluation([
      signal({
        severity: 'high',
        detectedAt: '2026-09-08T12:05:00.000Z',
        lastSeenAt: '2026-09-08T12:05:00.000Z',
      }),
    ], snapshot({
      evaluatedAt: '2026-09-08T12:05:00.000Z',
      id: 'snapshot-2',
      stateFingerprint: 'b'.repeat(64),
    }))

    const signals = db.engineeringIntelligence.listSignals(workspace)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      fingerprint: hash,
      severity: 'high',
      firstSeenAt: '2026-09-08T12:00:00.000Z',
      lastSeenAt: '2026-09-08T12:05:00.000Z',
    })
    expect(db.engineeringIntelligence.listSnapshots(workspace)).toHaveLength(2)
    db.close()
  })

  it('resolve apenas sinais de categorias avaliadas e mantém categorias sem cobertura', () => {
    const db = create()
    const workspace = '/tmp/engineering-workspace'
    db.createConversation(workspace)
    db.engineeringIntelligence.saveEvaluation([signal()], snapshot())

    const resolved = snapshot({
      id: 'snapshot-2',
      evaluatedAt: '2026-09-08T12:10:00.000Z',
      signalFingerprints: [],
      signalStates: [],
      stateFingerprint: 'c'.repeat(64),
      categories: engineeringHealthCategories.map((category) => ({
        category,
        status: category === 'architecture' ? 'assessed' as const : 'not-assessed' as const,
        score: null,
        coverage: { available: category === 'architecture' ? 1 : 0, expected: null, percent: null },
        signalIds: [],
        evidence: [],
        evaluatedAt: '2026-09-08T12:10:00.000Z',
      })),
    })
    db.engineeringIntelligence.saveEvaluation([], resolved)

    expect(db.engineeringIntelligence.listSignals(workspace, 'resolved')).toHaveLength(1)
    expect(db.engineeringIntelligence.listSignals(workspace, 'resolved')[0]?.resolvedAt).toBe('2026-09-08T12:10:00.000Z')
    db.close()
  })

  it('move os dados derivados junto com o workspace', () => {
    const db = create()
    const source = '/tmp/engineering-source'
    const destination = '/tmp/engineering-destination'
    db.createConversation(source)
    db.engineeringIntelligence.saveEvaluation([signal({ workspace: source })], snapshot({ workspace: source }))

    db.relocateWorkspace(source, destination)

    expect(db.engineeringIntelligence.listSignals(destination)).toHaveLength(1)
    expect(db.engineeringIntelligence.latestSnapshot(destination)?.workspace).toBe(destination)
    expect(db.engineeringIntelligence.listSignals(source)).toHaveLength(0)
    db.close()
  })
})
