import { describe, expect, it } from 'vitest'
import { EngineeringCorrelationService } from '../electron/engineering/EngineeringCorrelationService'
import { ENGINEERING_HEALTH_POLICY_VERSION, type EngineeringSignal } from '../shared/engineeringIntelligence'

const signal = (kind: string, id: string): EngineeringSignal => ({
  id,
  workspace: '/tmp/correlation-workspace',
  category: 'testing',
  kind,
  title: kind,
  description: 'Sinal de validação determinístico.',
  severity: 'medium',
  confidence: 80,
  evidence: [{
    id: `evidence-${id}`,
    source: 'validation-run',
    sourceId: id,
    runId: id,
    detail: 'Falha observada.',
    observedAt: '2026-09-08T12:00:00.000Z',
  }],
  metric: null,
  source: 'deterministic',
  policyVersion: ENGINEERING_HEALTH_POLICY_VERSION,
  detectedAt: '2026-09-08T12:00:00.000Z',
  fingerprint: id.padEnd(64, 'a').slice(0, 64),
  status: 'active',
  firstSeenAt: '2026-09-08T12:00:00.000Z',
  lastSeenAt: '2026-09-08T12:00:00.000Z',
  resolvedAt: null,
})

describe('EngineeringCorrelationService', () => {
  it('não confunde dois exit codes do mesmo tipo com duas validações', () => {
    const correlations = new EngineeringCorrelationService().correlate([
      signal('validation-failure-test', 'a'),
      signal('validation-failure-test-legacy-exit', 'b'),
    ])

    expect(correlations.some((correlation) => correlation.fingerprint && correlation.title.includes('Mais de uma'))).toBe(false)
  })

  it('correlaciona tipos de validação distintos, não apenas sinais distintos', () => {
    const correlations = new EngineeringCorrelationService().correlate([
      signal('validation-failure-test', 'a'),
      signal('validation-failure-build', 'b'),
    ])

    expect(correlations.some((correlation) => correlation.title.includes('Mais de uma'))).toBe(true)
  })
})
