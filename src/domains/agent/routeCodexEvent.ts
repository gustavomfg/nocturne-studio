import type { Activity, AgentEvent, PlanStep } from '../../types'
import { normalizePlanStatus } from '../../shared/format'
import { getCurrentLanguage, translate } from '../../shared/i18n'

interface AgentEventHandlers {
  stream(delta: string): void
  activityDetail(id: string, type: Activity['type'], label: string, delta: string): void
  diff(value: string): void
  plan(value: PlanStep[], explanation?: string): void
  hasPlan(): boolean
  itemStarted(item: Record<string, unknown>): void
  itemCompleted(item: Record<string, unknown>): void
  fsChanged(paths: string[]): void
  approval(value: { key: string; kind: 'command' | 'file'; title: string; detail: string }): void
  turnCompleted(params: Record<string, unknown>): void
  error(message: string): void
  warning(message: string): void
}

export function routeAgentEvent(event: AgentEvent, handlers: AgentEventHandlers) {
  const language = getCurrentLanguage()
  const t = (key: string) => translate(language, key)
  const p = event.params
  if (event.method === 'item/agentMessage/delta') handlers.stream(String(p.delta ?? ''))
  if (event.method === 'item/reasoning/summaryTextDelta') handlers.activityDetail(String(p.itemId), 'reasoning', t('agent.analyzingProject'), String(p.delta ?? ''))
  if (event.method === 'item/commandExecution/outputDelta') handlers.activityDetail(String(p.itemId), 'command', t('agent.runningCommand'), String(p.delta ?? ''))
  if (event.method === 'item/fileChange/outputDelta') handlers.activityDetail(String(p.itemId), 'file', t('agent.applyingChanges'), String(p.delta ?? ''))
  if (event.method === 'turn/diff/updated') handlers.diff(String(p.diff ?? ''))
  if (event.method === 'turn/plan/updated') {
    const plan = Array.isArray(p.plan) ? p.plan.map((entry) => { const item = entry as Record<string, unknown>; return { step: String(item.step ?? ''), status: normalizePlanStatus(item.status) } }) : []
    handlers.plan(plan, String(p.explanation ?? ''))
  }
  if (event.method === 'item/plan/delta' && !handlers.hasPlan()) handlers.plan([{ step: String(p.delta ?? ''), status: 'inProgress' }])
  if (event.method === 'item/started') handlers.itemStarted(p.item as Record<string, unknown>)
  if (event.method === 'item/completed') handlers.itemCompleted(p.item as Record<string, unknown>)
  if (event.method === 'fs/changed') handlers.fsChanged(Array.isArray(p.changedPaths) ? p.changedPaths.map(String) : [])
  if (event.method === 'item/commandExecution/requestApproval') handlers.approval({ key: String(p.approvalKey), kind: 'command', title: t('agent.executeCommand'), detail: String(p.command ?? p.reason ?? '') })
  if (event.method === 'item/fileChange/requestApproval') handlers.approval({ key: String(p.approvalKey), kind: 'file', title: t('agent.applyChanges'), detail: t('agent.agentRequestedFilePermission') })
  if (event.method === 'turn/completed') handlers.turnCompleted(p)
  if (event.method === 'error') handlers.error(String((p.error as Record<string, unknown>)?.message ?? p.message ?? t('common.executionError')))
  if (event.method === 'warning') handlers.warning(String(p.message ?? p))
}
