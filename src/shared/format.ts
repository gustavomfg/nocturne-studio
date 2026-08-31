import type { ChangedFile, PlanStep } from '../types'
import type { AgentState } from '../../shared/agentState'
import { translate, type Language } from './i18n'

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
export function formatBytes(value: number) { return value < 1024 ? `${value} B` : value < 1_048_576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1_048_576).toFixed(1)} MB` }
export function relativeTime(date: string, language: 'pt-BR' | 'en' = 'pt-BR') {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000)
  if (language === 'en') return mins < 1 ? 'just now' : mins < 60 ? `${mins} min` : mins < 1_440 ? `${Math.floor(mins / 60)} hr` : `${Math.floor(mins / 1_440)} d`
  return mins < 1 ? 'agora' : mins < 60 ? `${mins} min` : mins < 1_440 ? `${Math.floor(mins / 60)} h` : `${Math.floor(mins / 1_440)} d`
}
export function describeChanges(value: unknown) { if (!Array.isArray(value)) return ''; return value.map((item) => String((item as Record<string, unknown>).path ?? '')).filter(Boolean).join('\n') }
export function parseChanges(value: unknown): ChangedFile[] { if (!Array.isArray(value)) return []; return value.map((item) => { const change = item as Record<string, unknown>; const rawKind = String(change.kind ?? 'modified').toLowerCase(); return { path: String(change.path ?? ''), kind: (rawKind.includes('add') ? 'created' : rawKind.includes('delete') ? 'deleted' : 'modified') as ChangedFile['kind'], status: String(change.status ?? 'completed') } }).filter((item) => item.path) }
export function normalizePlanStatus(value: unknown): PlanStep['status'] { const status = String(value).toLowerCase(); return status.includes('complete') ? 'completed' : status.includes('progress') ? 'inProgress' : 'pending' }
export function isBusy(status: AgentState) { return ['planning', 'running', 'waiting-approval', 'cancelling'].includes(status) }

export function humanizeCommand(command: string, language: Language = 'pt-BR') {
  const lower = command.toLowerCase()
  if (/\b(npm|pnpm|yarn)\s+(test|run test)|\b(vitest|jest|pytest|cargo test|go test)\b/.test(lower)) return translate(language, 'activity.runningTests')
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?(build|typecheck|lint)\b/.test(lower)) return lower.includes('lint') ? translate(language, 'activity.checkingCodeQuality') : lower.includes('typecheck') ? translate(language, 'activity.checkingTypes') : translate(language, 'activity.building')
  if (/\bgit\s+(status|diff|log)\b/.test(lower)) return translate(language, 'activity.analyzingGit')
  if (/\b(rg|grep|find|ls)\b/.test(lower)) return translate(language, 'activity.exploringFiles')
  if (/\b(cat|sed|head|tail)\b/.test(lower)) return translate(language, 'activity.readingFile', { file: commandTarget(command) })
  if (/\b(npm|pnpm|yarn)\s+(install|add)\b/.test(lower)) return translate(language, 'activity.installingDependencies')
  return translate(language, 'activity.runningCommand')
}
function commandTarget(command: string) { return command.match(/[\w./-]+\.[a-zA-Z0-9]+/)?.[0] ?? 'arquivo' }
