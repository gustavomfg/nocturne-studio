import { useCallback, useEffect, useRef } from 'react'
import { UI_TIMING } from '../../shared/constants'
import { useAppStore } from '../store'
import { isBusy } from './format'
import { getRendererRenderCounts } from './rendererDiagnostics'

export function useRendererPerformance(status: string) {
  const performanceRef = useRef({ startupMs: 0, conversationLoadMs: 0, longTasks: 0, longTaskDurationMs: 0, longestLongTaskMs: 0 })

  const reportRendererPerformance = useCallback(() => {
    const state = useAppStore.getState()
    void window.nocturne.diagnostics.rendererStats({
      responseSize: state.streaming.length,
      activities: state.activities.length,
      messages: state.messages.length,
      renderCounts: getRendererRenderCounts(),
      ...performanceRef.current,
    }).catch(() => undefined)
  }, [])

  const recordStartup = useCallback(() => {
    performanceRef.current.startupMs = performance.now()
    reportRendererPerformance()
  }, [reportRendererPerformance])

  const recordConversationLoaded = useCallback((durationMs: number) => {
    performanceRef.current.conversationLoadMs = durationMs
    reportRendererPerformance()
  }, [reportRendererPerformance])

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      performanceRef.current.longTasks += entries.length
      performanceRef.current.longTaskDurationMs += entries.reduce((total, entry) => total + entry.duration, 0)
      performanceRef.current.longestLongTaskMs = Math.max(
        performanceRef.current.longestLongTaskMs,
        ...entries.map((entry) => entry.duration),
      )
      reportRendererPerformance()
    })
    observer.observe({ entryTypes: ['longtask'] })
    return () => observer.disconnect()
  }, [reportRendererPerformance])

  useEffect(() => {
    if (!isBusy(status)) return
    const timer = setInterval(reportRendererPerformance, UI_TIMING.diagnosticsIntervalMs)
    return () => clearInterval(timer)
  }, [reportRendererPerformance, status])

  return { reportRendererPerformance, recordStartup, recordConversationLoaded }
}
