import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { ENGINEERING_INTELLIGENCE_LIMITS } from '../../shared/constants'
import type {
  EngineeringHealthSnapshot,
  EngineeringInsight,
  EngineeringSignal,
} from '../../shared/engineeringIntelligence'
import {
  engineeringHealthSnapshotSchema,
  engineeringInsightSchema,
  engineeringSignalSchema,
} from '../../shared/engineeringIntelligenceSchemas'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

interface EngineeringSignalRow {
  id: string
  workspace: string
  fingerprint: string
  category: EngineeringSignal['category']
  kind: string
  title: string
  description: string
  severity: EngineeringSignal['severity']
  confidence: number
  evidenceJson: string
  metricJson: string | null
  source: EngineeringSignal['source']
  policyVersion: number
  detectedAt: string
  status: EngineeringSignal['status']
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
}

interface EngineeringSnapshotRow {
  id: string
  workspace: string
  policyVersion: number
  evaluatedAt: string
  previousSnapshotId: string | null
  sourcesJson: string
  categoriesJson: string
  signalFingerprintsJson: string
  signalStatesJson: string
  stateFingerprint: string
}

interface EngineeringInsightRow {
  id: string
  workspace: string
  fingerprint: string
  title: string
  explanation: string
  relatedSignalIdsJson: string
  evidenceJson: string
  suggestedAction: string | null
  confidence: number
  status: EngineeringInsight['status']
  createdAt: string
  updatedAt: string
  lastSeenAt: string
}

/** Persists bounded, reproducible engineering findings and completed evaluations. */
export class EngineeringIntelligenceRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  saveEvaluation(signals: readonly EngineeringSignal[], snapshot: EngineeringHealthSnapshot): EngineeringHealthSnapshot {
    for (const signal of signals) engineeringSignalSchema.parse(signal)
    engineeringHealthSnapshotSchema.parse(snapshot)

    return this.transactions.run('engineeringIntelligence.saveEvaluation', () => {
      const fingerprints = new Set(signals.map((signal) => signal.fingerprint))
      for (const signal of signals) this.upsertSignal(signal)

      const assessedCategories = snapshot.categories
        .filter((category) => category.status === 'assessed')
        .map((category) => category.category)
      if (assessedCategories.length > 0) {
        const categoryPlaceholders = assessedCategories.map(() => '?').join(',')
        const activeRows = this.database.prepare(`SELECT fingerprint FROM engineering_signals
          WHERE workspace=? AND status='active' AND category IN (${categoryPlaceholders})`).all(
          snapshot.workspace,
          ...assessedCategories,
        ) as Array<{ fingerprint: string }>
        for (const row of activeRows) {
          if (!fingerprints.has(row.fingerprint)) {
            this.database.prepare(`UPDATE engineering_signals SET status='resolved',resolved_at=?
              WHERE workspace=? AND fingerprint=? AND status='active'`).run(snapshot.evaluatedAt, snapshot.workspace, row.fingerprint)
          }
        }
      }

      const existing = this.database.prepare(`SELECT id,workspace,policy_version policyVersion,evaluated_at evaluatedAt,
        previous_snapshot_id previousSnapshotId,sources_json sourcesJson,categories_json categoriesJson,
        signal_fingerprints_json signalFingerprintsJson,signal_states_json signalStatesJson,state_fingerprint stateFingerprint
        FROM engineering_health_snapshots WHERE workspace=? AND state_fingerprint=?`).get(
        snapshot.workspace,
        snapshot.stateFingerprint,
      ) as EngineeringSnapshotRow | undefined
      if (existing) return fromSnapshotRow(existing)

      this.database.prepare(`INSERT INTO engineering_health_snapshots(
        id,workspace,policy_version,evaluated_at,previous_snapshot_id,sources_json,categories_json,
        signal_fingerprints_json,signal_states_json,state_fingerprint
      ) VALUES(@id,@workspace,@policyVersion,@evaluatedAt,@previousSnapshotId,@sourcesJson,@categoriesJson,
        @signalFingerprintsJson,@signalStatesJson,@stateFingerprint)`).run({
        id: snapshot.id,
        workspace: snapshot.workspace,
        policyVersion: snapshot.policyVersion,
        evaluatedAt: snapshot.evaluatedAt,
        previousSnapshotId: snapshot.previousSnapshotId,
        sourcesJson: JSON.stringify(snapshot.sources),
        categoriesJson: JSON.stringify(snapshot.categories),
        signalFingerprintsJson: JSON.stringify(snapshot.signalFingerprints),
        signalStatesJson: JSON.stringify(snapshot.signalStates),
        stateFingerprint: snapshot.stateFingerprint,
      })
      return snapshot
    })
  }

  listSignals(workspace: string, status?: EngineeringSignal['status'], limit = ENGINEERING_INTELLIGENCE_LIMITS.maxSignals): EngineeringSignal[] {
    const boundedLimit = Math.max(1, Math.min(ENGINEERING_INTELLIGENCE_LIMITS.maxSignals, Math.trunc(limit)))
    const rows = status
      ? this.database.prepare(`${signalSelect} WHERE workspace=? AND status=? ORDER BY last_seen_at DESC LIMIT ?`).all(workspace, status, boundedLimit)
      : this.database.prepare(`${signalSelect} WHERE workspace=? ORDER BY last_seen_at DESC LIMIT ?`).all(workspace, boundedLimit)
    return (rows as EngineeringSignalRow[]).map(fromSignalRow)
  }

  getSignal(workspace: string, fingerprint: string): EngineeringSignal | null {
    const row = this.database.prepare(`${signalSelect} WHERE workspace=? AND fingerprint=?`).get(workspace, fingerprint) as EngineeringSignalRow | undefined
    return row ? fromSignalRow(row) : null
  }

  latestSnapshot(workspace: string): EngineeringHealthSnapshot | null {
    const row = this.database.prepare(`${snapshotSelect} WHERE workspace=? ORDER BY evaluated_at DESC LIMIT 1`).get(workspace) as EngineeringSnapshotRow | undefined
    return row ? fromSnapshotRow(row) : null
  }

  listSnapshots(workspace: string, limit = ENGINEERING_INTELLIGENCE_LIMITS.maxSnapshots): EngineeringHealthSnapshot[] {
    const boundedLimit = Math.max(1, Math.min(ENGINEERING_INTELLIGENCE_LIMITS.maxSnapshots, Math.trunc(limit)))
    const rows = this.database.prepare(`${snapshotSelect} WHERE workspace=? ORDER BY evaluated_at DESC LIMIT ?`).all(workspace, boundedLimit) as EngineeringSnapshotRow[]
    return rows.map(fromSnapshotRow)
  }

  saveInsight(insight: EngineeringInsight): EngineeringInsight {
    engineeringInsightSchema.parse(insight)
    return this.transactions.run('engineeringIntelligence.saveInsight', () => {
      const existing = this.database.prepare('SELECT id,created_at createdAt FROM engineering_insights WHERE workspace=? AND fingerprint=?').get(
        insight.workspace,
        insight.fingerprint,
      ) as { id: string; createdAt: string } | undefined
      const value = existing ? { ...insight, id: existing.id, createdAt: existing.createdAt } : insight
      this.database.prepare(`INSERT INTO engineering_insights(
        id,workspace,fingerprint,title,explanation,related_signal_ids_json,evidence_json,suggested_action,
        confidence,status,created_at,updated_at,last_seen_at
      ) VALUES(@id,@workspace,@fingerprint,@title,@explanation,@relatedSignalIdsJson,@evidenceJson,@suggestedAction,
        @confidence,@status,@createdAt,@updatedAt,@lastSeenAt)
      ON CONFLICT(workspace,fingerprint) DO UPDATE SET
        title=excluded.title,explanation=excluded.explanation,related_signal_ids_json=excluded.related_signal_ids_json,
        evidence_json=excluded.evidence_json,suggested_action=excluded.suggested_action,confidence=excluded.confidence,
        status=excluded.status,updated_at=excluded.updated_at,last_seen_at=excluded.last_seen_at`).run({
        id: value.id || randomUUID(),
        workspace: value.workspace,
        fingerprint: value.fingerprint,
        title: value.title,
        explanation: value.explanation,
        relatedSignalIdsJson: JSON.stringify(value.relatedSignalIds),
        evidenceJson: JSON.stringify(value.evidence),
        suggestedAction: value.suggestedAction,
        confidence: value.confidence,
        status: value.status,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        lastSeenAt: value.lastSeenAt,
      })
      return value
    })
  }

  listInsights(workspace: string, status?: EngineeringInsight['status'], limit = ENGINEERING_INTELLIGENCE_LIMITS.maxInsights): EngineeringInsight[] {
    const boundedLimit = Math.max(1, Math.min(ENGINEERING_INTELLIGENCE_LIMITS.maxInsights, Math.trunc(limit)))
    const rows = (status
      ? this.database.prepare(`${insightSelect} WHERE workspace=? AND status=? ORDER BY updated_at DESC LIMIT ?`).all(workspace, status, boundedLimit)
      : this.database.prepare(`${insightSelect} WHERE workspace=? ORDER BY updated_at DESC LIMIT ?`).all(workspace, boundedLimit)) as EngineeringInsightRow[]
    return rows.map(fromInsightRow)
  }

  private upsertSignal(signal: EngineeringSignal) {
    const existing = this.database.prepare('SELECT id,first_seen_at firstSeenAt FROM engineering_signals WHERE workspace=? AND fingerprint=?').get(
      signal.workspace,
      signal.fingerprint,
    ) as { id: string; firstSeenAt: string } | undefined
    const value = existing ? { ...signal, id: existing.id, firstSeenAt: existing.firstSeenAt } : signal
    this.database.prepare(`INSERT INTO engineering_signals(
      id,workspace,fingerprint,category,kind,title,description,severity,confidence,evidence_json,metric_json,
      source,policy_version,detected_at,status,first_seen_at,last_seen_at,resolved_at
    ) VALUES(@id,@workspace,@fingerprint,@category,@kind,@title,@description,@severity,@confidence,@evidenceJson,@metricJson,
      @source,@policyVersion,@detectedAt,@status,@firstSeenAt,@lastSeenAt,@resolvedAt)
    ON CONFLICT(workspace,fingerprint) DO UPDATE SET
      category=excluded.category,kind=excluded.kind,title=excluded.title,description=excluded.description,
      severity=excluded.severity,confidence=excluded.confidence,evidence_json=excluded.evidence_json,
      metric_json=excluded.metric_json,source=excluded.source,policy_version=excluded.policy_version,
      detected_at=excluded.detected_at,status=excluded.status,last_seen_at=excluded.last_seen_at,resolved_at=excluded.resolved_at`).run({
      id: value.id || randomUUID(),
      workspace: value.workspace,
      fingerprint: value.fingerprint,
      category: value.category,
      kind: value.kind,
      title: value.title,
      description: value.description,
      severity: value.severity,
      confidence: value.confidence,
      evidenceJson: JSON.stringify(value.evidence),
      metricJson: value.metric ? JSON.stringify(value.metric) : null,
      source: value.source,
      policyVersion: value.policyVersion,
      detectedAt: value.detectedAt,
      status: value.status,
      firstSeenAt: value.firstSeenAt,
      lastSeenAt: value.lastSeenAt,
      resolvedAt: value.resolvedAt,
    })
  }
}

const signalSelect = `SELECT id,workspace,fingerprint,category,kind,title,description,severity,confidence,
  evidence_json evidenceJson,metric_json metricJson,source,policy_version policyVersion,detected_at detectedAt,
  status,first_seen_at firstSeenAt,last_seen_at lastSeenAt,resolved_at resolvedAt FROM engineering_signals`

const snapshotSelect = `SELECT id,workspace,policy_version policyVersion,evaluated_at evaluatedAt,
  previous_snapshot_id previousSnapshotId,sources_json sourcesJson,categories_json categoriesJson,
  signal_fingerprints_json signalFingerprintsJson,signal_states_json signalStatesJson,state_fingerprint stateFingerprint
  FROM engineering_health_snapshots`

const insightSelect = `SELECT id,workspace,fingerprint,title,explanation,related_signal_ids_json relatedSignalIdsJson,
  evidence_json evidenceJson,suggested_action suggestedAction,confidence,status,created_at createdAt,
  updated_at updatedAt,last_seen_at lastSeenAt FROM engineering_insights`

function fromSignalRow(row: EngineeringSignalRow): EngineeringSignal {
  return engineeringSignalSchema.parse({
    id: row.id,
    workspace: row.workspace,
    fingerprint: row.fingerprint,
    category: row.category,
    kind: row.kind,
    title: row.title,
    description: row.description,
    severity: row.severity,
    confidence: row.confidence,
    evidence: parseJson(row.evidenceJson, 'evidências de engineering signal'),
    metric: row.metricJson ? parseJson(row.metricJson, 'métrica de engineering signal') : null,
    source: row.source,
    policyVersion: row.policyVersion,
    detectedAt: row.detectedAt,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
  })
}

function fromSnapshotRow(row: EngineeringSnapshotRow): EngineeringHealthSnapshot {
  return engineeringHealthSnapshotSchema.parse({
    id: row.id,
    workspace: row.workspace,
    policyVersion: row.policyVersion,
    evaluatedAt: row.evaluatedAt,
    previousSnapshotId: row.previousSnapshotId,
    sources: parseJson(row.sourcesJson, 'fontes do snapshot de engineering health'),
    categories: parseJson(row.categoriesJson, 'categorias do snapshot de engineering health'),
    signalFingerprints: parseJson(row.signalFingerprintsJson, 'fingerprints do snapshot de engineering health'),
    signalStates: parseJson(row.signalStatesJson, 'estados dos sinais do snapshot de engineering health'),
    stateFingerprint: row.stateFingerprint,
  })
}

function fromInsightRow(row: EngineeringInsightRow): EngineeringInsight {
  return engineeringInsightSchema.parse({
    id: row.id,
    workspace: row.workspace,
    fingerprint: row.fingerprint,
    title: row.title,
    explanation: row.explanation,
    relatedSignalIds: parseJson(row.relatedSignalIdsJson, 'sinais relacionados do insight'),
    evidence: parseJson(row.evidenceJson, 'evidências do insight'),
    suggestedAction: row.suggestedAction,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeenAt: row.lastSeenAt,
  })
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`O banco contém ${label} inválidas.`)
  }
}
