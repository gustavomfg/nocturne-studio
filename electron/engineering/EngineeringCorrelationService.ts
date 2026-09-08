import type { EngineeringEvidence, EngineeringSignal } from '../../shared/engineeringIntelligence'
import { engineeringFingerprint } from './EngineeringFingerprint'

export interface EngineeringCorrelation {
  fingerprint: string
  title: string
  explanation: string
  relatedSignalIds: string[]
  evidence: EngineeringEvidence[]
  suggestedAction: string | null
  confidence: number
}

/** Finds only explainable co-occurrences; it does not infer causality or use ML. */
export class EngineeringCorrelationService {
  correlate(signals: readonly EngineeringSignal[]): EngineeringCorrelation[] {
    const correlations: EngineeringCorrelation[] = []
    const architecture = signals.filter((signal) => signal.category === 'architecture' && signal.status === 'active')
    const testing = signals.filter((signal) => signal.category === 'testing' && signal.status === 'active')
    if (architecture.length && testing.length) {
      correlations.push(this.createCorrelation(
        'architecture-testing-co-occurrence',
        'Sinais estruturais e falha de validação no mesmo estado',
        'O Project Index registrou sinais estruturais e uma validação concreta falhou na mesma avaliação. A relação é uma co-ocorrência observável, não uma conclusão causal.',
        [...architecture, ...testing],
        'Inspecionar as evidências estruturais e repetir a validação após a decisão do desenvolvedor.',
      ))
    }
    const failedValidations = testing.filter((signal) => signal.kind.startsWith('validation-failure-'))
    if (failedValidations.length >= 2) {
      correlations.push(this.createCorrelation(
        'multiple-validation-failures',
        'Mais de uma validação falhou na mesma avaliação',
        'Diferentes tipos de validação produziram falhas concretas na mesma avaliação. O insight resume a recorrência observada sem atribuir uma causa não comprovada.',
        failedValidations,
        'Revisar os resultados estruturados por tipo de validação e escolher uma ordem explícita de correção.',
      ))
    }
    return correlations
  }

  private createCorrelation(
    kind: string,
    title: string,
    explanation: string,
    signals: readonly EngineeringSignal[],
    suggestedAction: string,
  ): EngineeringCorrelation {
    const relatedSignalIds = signals.map((signal) => signal.id).sort()
    const evidence = deduplicateEvidence(signals.flatMap((signal) => signal.evidence)).slice(0, 20)
    return {
      fingerprint: engineeringFingerprint({ kind, signals: signals.map((signal) => signal.fingerprint).sort() }),
      title,
      explanation,
      relatedSignalIds,
      evidence,
      suggestedAction,
      confidence: Math.min(90, Math.min(...signals.map((signal) => signal.confidence))),
    }
  }
}

function deduplicateEvidence(evidence: readonly EngineeringEvidence[]): EngineeringEvidence[] {
  return [...new Map(evidence.map((item) => [item.id, item])).values()]
}
