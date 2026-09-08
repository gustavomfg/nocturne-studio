import { z } from 'zod'
import { CODE_INTELLIGENCE_LIMITS, ENGINEERING_INTELLIGENCE_LIMITS } from './constants'
import {
  engineeringEvidenceSources,
  engineeringHealthCategories,
  engineeringSignalSeverities,
  engineeringSignalSources,
  engineeringSignalStatuses,
  engineeringTrendKinds,
  healthAssessmentStatuses,
} from './engineeringIntelligence'

const timestamp = z.string().datetime({ offset: true })
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const workspace = z.string().trim().min(1).max(4_000)
const relativePath = z.string().trim().min(1).max(4_000)
const boundedId = z.string().trim().min(1).max(512)

export const engineeringEvidenceLocationSchema = z.object({
  startLine: z.number().int().min(1),
  startColumn: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  endColumn: z.number().int().min(1).optional(),
}).strict()

export const engineeringEvidenceSchema = z.object({
  id: boundedId,
  source: z.enum(engineeringEvidenceSources),
  sourceId: boundedId,
  relativePath: relativePath.optional(),
  sourceHash: hash.optional(),
  runId: boundedId.optional(),
  location: engineeringEvidenceLocationSchema.optional(),
  detail: z.string().trim().min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxEvidenceDetailCharacters),
  observedAt: timestamp,
}).strict()

export const engineeringMetricSchema = z.object({
  name: z.string().trim().min(1).max(200),
  value: z.union([z.number().finite(), z.string().max(500), z.boolean(), z.null()]),
  unit: z.string().trim().min(1).max(50).optional(),
}).strict()

export const engineeringSignalSchema = z.object({
  id: boundedId,
  workspace,
  category: z.enum(engineeringHealthCategories),
  kind: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxTitleCharacters),
  description: z.string().trim().min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxDescriptionCharacters),
  severity: z.enum(engineeringSignalSeverities),
  confidence: z.number().int().min(0).max(100),
  evidence: z.array(engineeringEvidenceSchema).min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxEvidencePerSignal),
  metric: engineeringMetricSchema.nullable(),
  source: z.enum(engineeringSignalSources),
  policyVersion: z.number().int().min(1),
  detectedAt: timestamp,
  fingerprint: hash,
  status: z.enum(engineeringSignalStatuses),
  firstSeenAt: timestamp,
  lastSeenAt: timestamp,
  resolvedAt: timestamp.nullable(),
}).strict()

export const healthEvidenceCoverageSchema = z.object({
  available: z.number().int().min(0),
  expected: z.number().int().min(0).nullable(),
  percent: z.number().finite().min(0).max(100).nullable(),
}).strict()

export const healthCategoryResultSchema = z.object({
  category: z.enum(engineeringHealthCategories),
  status: z.enum(healthAssessmentStatuses),
  score: z.number().finite().min(0).max(100).nullable(),
  coverage: healthEvidenceCoverageSchema,
  signalIds: z.array(boundedId).max(ENGINEERING_INTELLIGENCE_LIMITS.maxSignals),
  evidence: z.array(engineeringEvidenceSchema).max(ENGINEERING_INTELLIGENCE_LIMITS.maxEvidencePerSignal),
  evaluatedAt: timestamp,
}).strict()

export const engineeringSourceRunsSchema = z.object({
  projectIndexRunId: boundedId.nullable(),
  semanticIndexRunId: boundedId.nullable(),
  validationRunIds: z.array(boundedId).max(CODE_INTELLIGENCE_LIMITS.maxQueryResults),
  executionIds: z.array(boundedId).max(CODE_INTELLIGENCE_LIMITS.maxQueryResults),
  changeSetIds: z.array(boundedId).max(CODE_INTELLIGENCE_LIMITS.maxQueryResults),
}).strict()

export const engineeringHealthSnapshotSchema = z.object({
  id: boundedId,
  workspace,
  policyVersion: z.number().int().min(1),
  evaluatedAt: timestamp,
  previousSnapshotId: boundedId.nullable(),
  sources: engineeringSourceRunsSchema,
  categories: z.array(healthCategoryResultSchema).length(engineeringHealthCategories.length),
  signalFingerprints: z.array(hash).max(ENGINEERING_INTELLIGENCE_LIMITS.maxSignals),
  signalStates: z.array(z.object({
    fingerprint: hash,
    category: z.enum(engineeringHealthCategories),
    severity: z.enum(engineeringSignalSeverities),
    status: z.enum(engineeringSignalStatuses),
  }).strict()).max(ENGINEERING_INTELLIGENCE_LIMITS.maxSignals),
  stateFingerprint: hash,
}).strict()

export const engineeringTrendSchema = z.object({
  id: boundedId,
  workspace,
  signalFingerprint: hash,
  kind: z.enum(engineeringTrendKinds),
  fromSnapshotId: boundedId.nullable(),
  toSnapshotId: boundedId,
  category: z.enum(engineeringHealthCategories),
  previousSeverity: z.enum(engineeringSignalSeverities).nullable(),
  currentSeverity: z.enum(engineeringSignalSeverities).nullable(),
  createdAt: timestamp,
}).strict()

export const engineeringInsightSchema = z.object({
  id: boundedId,
  workspace,
  fingerprint: hash,
  title: z.string().trim().min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxTitleCharacters),
  explanation: z.string().trim().min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxDescriptionCharacters),
  relatedSignalIds: z.array(boundedId).max(ENGINEERING_INTELLIGENCE_LIMITS.maxSignals),
  evidence: z.array(engineeringEvidenceSchema).min(1).max(ENGINEERING_INTELLIGENCE_LIMITS.maxEvidencePerSignal),
  suggestedAction: z.string().trim().min(1).max(2_000).nullable(),
  confidence: z.number().int().min(0).max(100),
  status: z.enum(engineeringSignalStatuses),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastSeenAt: timestamp,
}).strict()
