import { useEffect, useRef } from 'react'
import type { Activity } from '../../types'
import { useAppStore } from '../../store'
import { describeChanges, humanizeCommand, parseChanges } from '../../shared/format'
import { UI_TIMING } from '../../../shared/constants'
import { useI18n } from '../../shared/i18n'

export function useBufferedAgentEvents() {
  const { t, language } = useI18n()
  const streamBufferRef = useRef('')
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityBuffersRef = useRef(new Map<string, { type: Activity['type']; label: string; detail: string }>())
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushStream = () => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current)
    streamTimerRef.current = null
    const buffered = streamBufferRef.current; streamBufferRef.current = ''
    if (buffered) useAppStore.getState().appendStream(buffered)
  }
  const queueStreamDelta = (delta: string) => {
    streamBufferRef.current += delta
    if (streamBufferRef.current.length > 100_000) streamBufferRef.current = streamBufferRef.current.slice(-100_000)
    if (!streamTimerRef.current) streamTimerRef.current = setTimeout(flushStream, UI_TIMING.streamFlushMs)
  }
  const flushActivityDetails = () => {
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    activityTimerRef.current = null
    const store = useAppStore.getState()
    for (const [id, buffered] of activityBuffersRef.current) {
      const current = store.activities.find((item) => item.id === id)
      store.upsertActivity({ id, type: buffered.type, label: current?.label || buffered.label, detail: `${current?.detail || ''}${buffered.detail}`.slice(-64_000), status: 'running' })
    }
    activityBuffersRef.current.clear()
  }
  const appendActivityDetail = (id: string, type: Activity['type'], label: string, delta: string) => {
    const buffered = activityBuffersRef.current.get(id)
    activityBuffersRef.current.set(id, { type, label: buffered?.label || label, detail: `${buffered?.detail || ''}${delta}`.slice(-64_000) })
    if (!activityTimerRef.current) activityTimerRef.current = setTimeout(flushActivityDetails, UI_TIMING.activityFlushMs)
  }
  const addItemActivity = (item?: Record<string, unknown>) => {
    if (!item) return
    const store = useAppStore.getState(); const type = String(item.type)
    if (type === 'commandExecution') store.upsertActivity({ id: String(item.id), type: 'command', label: humanizeCommand(String(item.command ?? ''), language), detail: String(item.command ?? ''), status: 'running' })
    if (type === 'fileChange') store.upsertActivity({ id: String(item.id), type: 'file', label: t('agent.preparingFileChanges'), status: 'running' })
    if (type === 'mcpToolCall' || type === 'dynamicToolCall') store.upsertActivity({ id: String(item.id), type: 'read', label: `${t('common.tool')}: ${String(item.tool ?? type)}`, detail: JSON.stringify(item.arguments ?? ''), status: 'running' })
  }
  const completeItem = (item?: Record<string, unknown>) => {
    if (!item) return
    flushActivityDetails()
    const store = useAppStore.getState(); const type = String(item.type)
    if (type === 'commandExecution') store.upsertActivity({ id: String(item.id), type: 'command', label: humanizeCommand(String(item.command ?? ''), language), detail: [String(item.command ?? ''), String(item.aggregatedOutput ?? '')].filter(Boolean).join('\n\n'), status: item.status === 'failed' ? 'failed' : 'completed' })
    if (type === 'fileChange') { store.upsertActivity({ id: String(item.id), type: 'file', label: t('common.filesUpdated'), detail: describeChanges(item.changes), status: item.status === 'failed' ? 'failed' : 'completed' }); store.addFiles(parseChanges(item.changes)) }
    if (type === 'mcpToolCall' || type === 'dynamicToolCall') store.upsertActivity({ id: String(item.id), type: 'read', label: `${t('common.completedTool')}: ${String(item.tool ?? type)}`, detail: item.error ? JSON.stringify(item.error) : undefined, status: item.error ? 'failed' : 'completed' })
  }

  useEffect(() => () => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current)
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    streamBufferRef.current = ''; activityBuffersRef.current.clear()
  }, [])

  return { queueStreamDelta, flushStream, appendActivityDetail, addItemActivity, completeItem }
}
