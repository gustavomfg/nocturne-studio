import { useCallback, useState } from 'react'
import type { WorkspaceMemory } from '../../types'
import { errorMessage } from '../../shared/format'
import { useAppStore } from '../../store'
import { useI18n } from '../../shared/i18n'

export const emptyWorkspaceMemory: WorkspaceMemory = { content: '', rules: '', updatedAt: '' }

interface WorkspaceMemoryOptions {
  onClose(): void
  onNotify(message: string): void
}

export function useWorkspaceMemory({ onClose, onNotify }: WorkspaceMemoryOptions) {
  const { t } = useI18n()
  const [memory, setMemory] = useState<WorkspaceMemory>(emptyWorkspaceMemory)

  const refreshMemory = useCallback(async (conversationId: string) => {
    const next = await window.nocturne.memory.get(conversationId)
    if (useAppStore.getState().activeId === conversationId) setMemory(next)
  }, [])

  const loadMemory = useCallback((conversationId: string) => window.nocturne.memory.get(conversationId), [])

  const clearMemory = useCallback(() => {
    setMemory(emptyWorkspaceMemory)
  }, [])

  const saveMemory = useCallback(async (content: string, rules: string) => {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId) return
    try {
      setMemory(await window.nocturne.memory.set(conversationId, content, rules))
      onClose()
      onNotify(t('memory.saved'))
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  }, [onClose, onNotify, t])

  return { memory, setMemory, refreshMemory, loadMemory, clearMemory, saveMemory }
}
