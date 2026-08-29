import { useCallback, useState } from 'react'
import type { Artifact, FilePreview } from '../../types'
import { errorMessage } from '../../shared/format'
import { useAppStore } from '../../store'
import { useI18n } from '../../shared/i18n'

interface ConfirmationOptions {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
}

interface ArtifactActionsOptions {
  confirm(options: ConfirmationOptions): Promise<boolean>
  onError(message: string): void
  onRefreshArtifacts(conversationId?: string): Promise<void>
}

export function useArtifactActions({ confirm, onError, onRefreshArtifacts }: ArtifactActionsOptions) {
  const { t } = useI18n()
  const [preview, setPreview] = useState<FilePreview | null>(null)

  const resetPreview = useCallback(() => {
    setPreview(null)
  }, [])

  const showFilePreview = useCallback(async (filePath: string) => {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId) return
    try {
      setPreview(await window.nocturne.files.preview(conversationId, filePath))
    } catch (error) {
      onError(errorMessage(error))
    }
  }, [onError])

  const showArtifact = useCallback((artifact: Artifact) => {
    const conversationId = useAppStore.getState().activeId
    if (artifact.filePath) {
      if (/\.(pdf|docx)$/i.test(artifact.filePath)) {
        if (conversationId) void window.nocturne.files.open(conversationId, artifact.filePath, 'file').catch((error) => onError(errorMessage(error)))
        return
      }
      void showFilePreview(artifact.filePath)
      return
    }
    setPreview({
      kind: artifact.type === 'response' || artifact.type === 'document' ? 'markdown' : 'text',
      name: artifact.title,
      filePath: '',
      mime: 'text/plain',
      content: artifact.content || '',
      size: artifact.content?.length || 0,
    })
  }, [onError, showFilePreview])

  const deleteArtifact = useCallback(async (artifactId: string) => {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId) return
    if (!await confirm({ title: t('common.removeArtifact'), description: t('common.artifactRemoved'), confirmLabel: t('common.remove'), danger: true })) return
    const previous = useAppStore.getState().artifacts
    useAppStore.getState().setArtifacts(previous.filter((artifact) => artifact.id !== artifactId))
    try {
      await window.nocturne.artifacts.delete(conversationId, artifactId)
      if (useAppStore.getState().activeId === conversationId) await onRefreshArtifacts(conversationId)
      setPreview(null)
    } catch (error) {
      if (useAppStore.getState().activeId === conversationId) useAppStore.getState().setArtifacts(previous)
      onError(errorMessage(error))
    }
  }, [confirm, onError, onRefreshArtifacts, t])

  const refreshArtifacts = useCallback(async () => {
    await onRefreshArtifacts(useAppStore.getState().activeId ?? undefined)
  }, [onRefreshArtifacts])

  return { preview, resetPreview, showFilePreview, showArtifact, deleteArtifact, refreshArtifacts }
}
