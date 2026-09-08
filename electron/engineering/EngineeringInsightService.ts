import crypto from 'node:crypto'
import type { EngineeringInsight, EngineeringSignal } from '../../shared/engineeringIntelligence'
import type { EngineeringIntelligenceRepository } from '../database/EngineeringIntelligenceRepository'
import { EngineeringCorrelationService } from './EngineeringCorrelationService'

/** Materializes deterministic correlations as persisted insights, separate from suggestions. */
export class EngineeringInsightService {
  constructor(
    private readonly repository: EngineeringIntelligenceRepository,
    private readonly correlations: EngineeringCorrelationService = new EngineeringCorrelationService(),
  ) {}

  generate(workspace: string, signals: readonly EngineeringSignal[], evaluatedAt: string): EngineeringInsight[] {
    return this.correlations.correlate(signals).map((correlation) => this.repository.saveInsight({
      id: `engineering-insight-${crypto.randomUUID()}`,
      workspace,
      fingerprint: correlation.fingerprint,
      title: correlation.title,
      explanation: correlation.explanation,
      relatedSignalIds: correlation.relatedSignalIds,
      evidence: correlation.evidence,
      suggestedAction: correlation.suggestedAction,
      confidence: correlation.confidence,
      status: 'active',
      createdAt: evaluatedAt,
      updatedAt: evaluatedAt,
      lastSeenAt: evaluatedAt,
    }))
  }
}
