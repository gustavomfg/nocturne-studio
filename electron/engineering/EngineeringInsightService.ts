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

  generate(
    workspace: string,
    signals: readonly EngineeringSignal[],
    evaluatedAt: string,
  ): EngineeringInsight[] {
    const generated = this.correlations.correlate(signals).map((correlation) => this.repository.saveInsight({
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
    this.reconcile(workspace, signals, generated, evaluatedAt)
    return generated
  }

  private reconcile(
    workspace: string,
    currentSignals: readonly EngineeringSignal[],
    generated: readonly EngineeringInsight[],
    evaluatedAt: string,
  ) {
    const generatedFingerprints = new Set(generated.map((insight) => insight.fingerprint))
    const allSignals = this.repository.listSignals(workspace)
    const byId = new Map(allSignals.map((signal) => [signal.id, signal]))
    const currentIds = new Set(currentSignals.map((signal) => signal.id))
    for (const insight of this.repository.listInsights(workspace, 'active')) {
      if (generatedFingerprints.has(insight.fingerprint) || !insight.relatedSignalIds.length) continue
      const related = insight.relatedSignalIds.map((id) => byId.get(id))
      if (related.some((signal) => !signal)) continue
      if (!related.every((signal) => signal!.status === 'resolved' || currentIds.has(signal!.id))) continue
      this.repository.resolveInsight(workspace, insight.id, evaluatedAt)
    }
  }
}
