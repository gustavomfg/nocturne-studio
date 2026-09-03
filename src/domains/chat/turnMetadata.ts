import type { Activity, ChangedFile, PlanStep } from '../../types'
import { useAppStore } from '../../store'

export interface ConversationTurnMetadata {
  executionId?: string
  diff?: string
  activities?: Activity[]
  files?: ChangedFile[]
  plan?: PlanStep[]
  planExplanation?: string
}

export function parseConversationTurnMetadata(value: string): ConversationTurnMetadata | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return {
      executionId: typeof record.executionId === 'string' ? record.executionId : undefined,
      diff: typeof record.diff === 'string' ? record.diff : undefined,
      activities: Array.isArray(record.activities) ? record.activities as Activity[] : undefined,
      files: Array.isArray(record.files) ? record.files as ChangedFile[] : undefined,
      plan: Array.isArray(record.plan) ? record.plan as PlanStep[] : undefined,
      planExplanation: typeof record.planExplanation === 'string' ? record.planExplanation : undefined,
    }
  } catch {
    return null
  }
}

export function restoreConversationTurnMetadata(value: string) {
  const parsed = parseConversationTurnMetadata(value)
  if (!parsed) return
  const store = useAppStore.getState()
  if (parsed.diff) store.setDiff(parsed.diff)
  if (parsed.executionId) store.setExecutionId(parsed.executionId)
  if (parsed.activities) parsed.activities.forEach(store.upsertActivity)
  if (parsed.files) store.setFiles(parsed.files)
  if (parsed.plan) store.setPlan(parsed.plan, parsed.planExplanation)
}
