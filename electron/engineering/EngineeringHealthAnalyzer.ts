import crypto from 'node:crypto'
import type {
  EngineeringHealthSnapshot,
  EngineeringSignal,
  HealthCategoryResult,
} from '../../shared/engineeringIntelligence'
import { ENGINEERING_HEALTH_POLICY_VERSION, engineeringHealthCategories } from '../../shared/engineeringIntelligence'
import { engineeringFingerprint } from './EngineeringFingerprint'

export interface EngineeringHealthAnalysisInput {
  workspace: string
  evaluatedAt: string
  previousSnapshotId: string | null
  sources: EngineeringHealthSnapshot['sources']
  categories: readonly HealthCategoryResult[]
  signals: readonly EngineeringSignal[]
}

/** Builds category health without inventing coverage or collapsing it into a global score. */
export class EngineeringHealthAnalyzer {
  analyze(input: EngineeringHealthAnalysisInput): EngineeringHealthSnapshot {
    const categories = engineeringHealthCategories.map((category) => {
      const existing = input.categories.find((item) => item.category === category)
      const signals = input.signals.filter((signal) => signal.category === category)
      return {
        category,
        status: existing?.status ?? 'not-assessed',
        score: existing?.score ?? null,
        coverage: existing?.coverage ?? { available: 0, expected: null, percent: null },
        signalIds: signals.map((signal) => signal.id),
        evidence: existing?.evidence ?? [],
        evaluatedAt: input.evaluatedAt,
      } satisfies HealthCategoryResult
    })
    const stateFingerprint = engineeringFingerprint({
      policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
      sources: input.sources,
      categories: categories.map(({ category, status, coverage }) => ({ category, status, coverage })),
      signals: input.signals
        .map(({ fingerprint, severity, status }) => ({ fingerprint, severity, status }))
        .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    })
    return {
      id: `engineering-snapshot-${crypto.randomUUID()}`,
      workspace: input.workspace,
      policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
      evaluatedAt: input.evaluatedAt,
      previousSnapshotId: input.previousSnapshotId,
      sources: input.sources,
      categories,
      signalFingerprints: input.signals.map((signal) => signal.fingerprint).sort(),
      signalStates: input.signals.map((signal) => ({
        fingerprint: signal.fingerprint,
        category: signal.category,
        severity: signal.severity,
        status: signal.status,
      })).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
      stateFingerprint,
    }
  }
}
