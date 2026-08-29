import { useCallback, useState } from 'react'
import type { GitInfo } from '../../types'
import { useAppStore } from '../../store'

export function useGitSession() {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)

  const refreshGit = useCallback(async (conversationId = useAppStore.getState().activeId) => {
    if (!conversationId) return
    try {
      const info = await window.nocturne.git.status(conversationId)
      if (useAppStore.getState().activeId !== conversationId) return
      setGitInfo(info)
      if (info.diff && !useAppStore.getState().diff) useAppStore.getState().setDiff(info.diff)
    } catch {
      if (useAppStore.getState().activeId === conversationId) setGitInfo(null)
    }
  }, [])

  const clearGit = useCallback(() => setGitInfo(null), [])

  return { gitInfo, refreshGit, clearGit }
}
