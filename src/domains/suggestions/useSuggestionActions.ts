import { useCallback } from 'react'
import type { AgentMode, PlanStep, Suggestion, SuggestionStatus } from '../../types'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'

interface ConfirmationOptions {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
}

interface SuggestionActionsOptions {
  activeConversationId: string | null
  isInteractionLocked(): boolean
  confirm(options: ConfirmationOptions): Promise<boolean>
  refreshSuggestions(conversationId: string): Promise<void>
  onError(value: string): void
  onSetPlan(plan: PlanStep[], explanation?: string): void
  onMarkApplication(id: string, affectedFiles: string[]): void
  onSubmitPrompt(prompt: string, mode: AgentMode): Promise<void>
}

export function useSuggestionActions({ activeConversationId, isInteractionLocked, confirm, refreshSuggestions, onError, onSetPlan, onMarkApplication, onSubmitPrompt }: SuggestionActionsOptions) {
  const { t } = useI18n()

  const persistSuggestionStatus = useCallback(async (suggestion: Suggestion, status: SuggestionStatus) => {
    if (!activeConversationId) throw new Error(t('common.openConversationForSuggestion'))
    await window.nocturne.suggestions.status(activeConversationId, suggestion.id, status)
    await refreshSuggestions(activeConversationId)
  }, [activeConversationId, refreshSuggestions, t])

  const updateSuggestion = useCallback(async (suggestion: Suggestion, status: SuggestionStatus) => {
    try {
      await persistSuggestionStatus(suggestion, status)
    } catch (error) {
      onError(errorMessage(error))
    }
  }, [onError, persistSuggestionStatus])

  const applySuggestion = useCallback(async (suggestion: Suggestion) => {
    if (!activeConversationId || isInteractionLocked()) return
    const steps: PlanStep[] = [
      { step: t('common.confirmScope', { count: suggestion.affectedFiles.length || 1 }), status: 'pending' },
      { step: t('common.applyApprovedProposal'), status: 'pending' },
      { step: t('common.runValidation'), status: 'pending' },
      { step: t('common.reportChanges'), status: 'pending' },
    ]
    const files = suggestion.affectedFiles.length ? suggestion.affectedFiles.join('\n• ') : t('common.filesToConfirm')
    if (!await confirm({
      title: t('common.applySuggestionConfirm'),
      description: `${suggestion.title}\n\n${t('common.filesLabel')}:\n• ${files}\n\n${t('common.approvedScopeDescription')}`,
      confirmLabel: t('common.prepareApplication'),
    })) return
    try {
      await persistSuggestionStatus(suggestion, 'accepted')
    } catch (error) {
      onError(`${t('common.suggestionNotAccepted')}: ${errorMessage(error)}`)
      return
    }
    onSetPlan(steps, `${t('common.suggestionApplication')}: ${suggestion.title}`)
    onMarkApplication(suggestion.id, suggestion.affectedFiles)
    await onSubmitPrompt(`${t('quick.applySuggestion')}\n\n${t('quick.title')}: ${suggestion.title}\n${t('quick.problem')}: ${suggestion.description}\n${t('quick.reasoning')}: ${suggestion.reasoning}\n${t('quick.files')}: ${suggestion.affectedFiles.join(', ') || t('common.identifyBeforeEditing')}\n${t('quick.proposal')}:\n${suggestion.proposedChanges}`, 'build')
  }, [activeConversationId, confirm, isInteractionLocked, onError, onMarkApplication, onSetPlan, onSubmitPrompt, persistSuggestionStatus, t])

  return { updateSuggestion, applySuggestion }
}
