import type {
  EngineeringHealthSnapshot,
  EngineeringSignalSeverity,
  EngineeringTrend,
} from '../../shared/engineeringIntelligence'

const severityRank: Record<EngineeringSignalSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

/** Compares immutable snapshots; it never treats missing coverage as a negative trend. */
export class EngineeringTrendService {
  compare(previous: EngineeringHealthSnapshot | null, current: EngineeringHealthSnapshot): EngineeringTrend[] {
    if (!previous) return []
    const trends: EngineeringTrend[] = []
    const previousStates = new Map(previous.signalStates.map((state) => [state.fingerprint, state]))
    const currentStates = new Map(current.signalStates.map((state) => [state.fingerprint, state]))
    const fingerprints = new Set([...previousStates.keys(), ...currentStates.keys()])
    for (const fingerprint of fingerprints) {
      const before = previousStates.get(fingerprint)
      const after = currentStates.get(fingerprint)
      if (!before && after) {
        trends.push(this.trend(current, fingerprint, 'new', after.category, null, after.severity, previous.id))
      } else if (before && !after) {
        trends.push(this.trend(current, fingerprint, 'resolved', before.category, before.severity, null, previous.id))
      } else if (before && after && before.severity !== after.severity) {
        trends.push(this.trend(current, fingerprint, severityRank[after.severity] < severityRank[before.severity] ? 'improved' : 'worsened', after.category, before.severity, after.severity, previous.id))
      }
    }
    for (const category of current.categories) {
      const previousCategory = previous.categories.find((item) => item.category === category.category)
      if (previousCategory && previousCategory.status !== category.status && !hasSignalTrend(trends, category.category)) {
        trends.push(this.trend(current, `category:${category.category}`, 'coverage-changed', category.category, null, null, previous.id))
      }
    }
    return trends
  }

  private trend(
    current: EngineeringHealthSnapshot,
    fingerprint: string,
    kind: EngineeringTrend['kind'],
    category: EngineeringTrend['category'],
    previousSeverity: EngineeringSignalSeverity | null,
    currentSeverity: EngineeringSignalSeverity | null,
    previousSnapshotId: string,
  ): EngineeringTrend {
    return {
      id: `engineering-trend-${current.id}-${fingerprint.slice(0, 16)}-${kind}`,
      workspace: current.workspace,
      signalFingerprint: fingerprint,
      kind,
      fromSnapshotId: previousSnapshotId,
      toSnapshotId: current.id,
      category,
      previousSeverity,
      currentSeverity,
      createdAt: current.evaluatedAt,
    }
  }
}

function hasSignalTrend(trends: readonly EngineeringTrend[], category: EngineeringTrend['category']) {
  return trends.some((trend) => trend.category === category && trend.signalFingerprint !== `category:${category}`)
}
