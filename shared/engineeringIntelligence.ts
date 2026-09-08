export const ENGINEERING_HEALTH_POLICY_VERSION = 1

export const engineeringHealthCategories = [
  'architecture',
  'testing',
  'security',
  'documentation',
  'dependencies',
  'performance',
  'developer-experience',
  'release',
] as const
export type EngineeringHealthCategory = typeof engineeringHealthCategories[number]

export const engineeringSignalSeverities = ['info', 'low', 'medium', 'high', 'critical'] as const
export type EngineeringSignalSeverity = typeof engineeringSignalSeverities[number]

export const engineeringSignalStatuses = ['active', 'resolved'] as const
export type EngineeringSignalStatus = typeof engineeringSignalStatuses[number]

export const healthAssessmentStatuses = ['assessed', 'partial', 'not-assessed'] as const
export type HealthAssessmentStatus = typeof healthAssessmentStatuses[number]

export const engineeringTrendKinds = ['new', 'resolved', 'improved', 'worsened', 'unchanged', 'coverage-changed'] as const
export type EngineeringTrendKind = typeof engineeringTrendKinds[number]

export const engineeringEvidenceSources = [
  'project-index-file',
  'project-index-run',
  'project-symbol',
  'project-import',
  'project-export',
  'stack-evidence',
  'semantic-index-run',
  'semantic-unit',
  'validation-run',
  'execution',
  'change-set',
  'change',
  'git-state',
  'local-metric',
] as const
export type EngineeringEvidenceSource = typeof engineeringEvidenceSources[number]

export const engineeringSignalSources = ['deterministic', 'correlation'] as const
export type EngineeringSignalSource = typeof engineeringSignalSources[number]

export interface EngineeringEvidenceLocation {
  startLine: number
  startColumn?: number
  endLine?: number
  endColumn?: number
}

/** A bounded reference to local evidence. It deliberately carries no source text. */
export interface EngineeringEvidence {
  id: string
  source: EngineeringEvidenceSource
  sourceId: string
  relativePath?: string
  sourceHash?: string
  runId?: string
  location?: EngineeringEvidenceLocation
  detail: string
  observedAt: string
}

export interface EngineeringMetric {
  name: string
  value: number | string | boolean | null
  unit?: string
}

export interface EngineeringSignal {
  id: string
  workspace: string
  category: EngineeringHealthCategory
  kind: string
  title: string
  description: string
  severity: EngineeringSignalSeverity
  /** Evidence quality and coverage, never model confidence. */
  confidence: number
  evidence: EngineeringEvidence[]
  metric: EngineeringMetric | null
  source: EngineeringSignalSource
  policyVersion: number
  detectedAt: string
  fingerprint: string
  status: EngineeringSignalStatus
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
}

export interface HealthEvidenceCoverage {
  available: number
  expected: number | null
  percent: number | null
}

export interface HealthCategoryResult {
  category: EngineeringHealthCategory
  status: HealthAssessmentStatus
  score: number | null
  coverage: HealthEvidenceCoverage
  signalIds: string[]
  evidence: EngineeringEvidence[]
  evaluatedAt: string
}

export interface EngineeringSourceRuns {
  projectIndexRunId: string | null
  semanticIndexRunId: string | null
  validationRunIds: string[]
  executionIds: string[]
  changeSetIds: string[]
}

export interface EngineeringSignalSnapshotState {
  fingerprint: string
  category: EngineeringHealthCategory
  severity: EngineeringSignalSeverity
  status: EngineeringSignalStatus
}

export interface EngineeringHealthSnapshot {
  id: string
  workspace: string
  policyVersion: number
  evaluatedAt: string
  previousSnapshotId: string | null
  sources: EngineeringSourceRuns
  categories: HealthCategoryResult[]
  signalFingerprints: string[]
  signalStates: EngineeringSignalSnapshotState[]
  stateFingerprint: string
}

export interface EngineeringTrend {
  id: string
  workspace: string
  signalFingerprint: string
  kind: EngineeringTrendKind
  fromSnapshotId: string | null
  toSnapshotId: string
  category: EngineeringHealthCategory
  previousSeverity: EngineeringSignalSeverity | null
  currentSeverity: EngineeringSignalSeverity | null
  createdAt: string
}

export interface EngineeringInsight {
  id: string
  workspace: string
  fingerprint: string
  title: string
  explanation: string
  relatedSignalIds: string[]
  evidence: EngineeringEvidence[]
  suggestedAction: string | null
  confidence: number
  status: EngineeringSignalStatus
  createdAt: string
  updatedAt: string
  lastSeenAt: string
}

export interface EngineeringHealthReport {
  snapshot: EngineeringHealthSnapshot
  signals: EngineeringSignal[]
  insights: EngineeringInsight[]
  trends: EngineeringTrend[]
}
