import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetectedStack, ProjectIndexStatus, ProjectIndexSummary, ProjectSymbol, StackEvidence, ValidationKind, ValidationRun } from '../../../shared/codeIntelligence'
import type { SemanticIndexStatus, SemanticIndexSummary, SemanticSearchResult } from '../../../shared/semanticIndex'
import type { EngineeringHealthReport } from '../../../shared/engineeringIntelligence'
import { errorMessage } from '../../shared/format'

interface ProjectIndexSessionOptions {
  workspace: string
  authorized: boolean
  onError(message: string): void
}

export function useProjectIndexSession({ workspace, authorized, onError }: ProjectIndexSessionOptions) {
  const [status, setStatus] = useState<ProjectIndexStatus | null>(null)
  const [summary, setSummary] = useState<ProjectIndexSummary | null>(null)
  const [stack, setStack] = useState<StackEvidence[]>([])
  const [symbols, setSymbols] = useState<ProjectSymbol[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [validationRuns, setValidationRuns] = useState<ValidationRun[]>([])
  const [validationLoading, setValidationLoading] = useState(false)
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null)
  const [semanticSummary, setSemanticSummary] = useState<SemanticIndexSummary | null>(null)
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([])
  const [semanticQuery, setSemanticQuery] = useState('')
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [engineeringReport, setEngineeringReport] = useState<EngineeringHealthReport | null>(null)
  const callbacksRef = useRef({ onError })
  callbacksRef.current = { onError }

  const refresh = useCallback(async () => {
    if (!workspace || !authorized) return
    const [nextStatus, nextSummary, nextStack, nextValidation, nextSemanticStatus, nextSemanticSummary, nextEngineeringReport] = await Promise.all([
      window.nocturne.projectIndex.status(workspace),
      window.nocturne.projectIndex.summary(workspace),
      window.nocturne.projectIndex.stack(workspace),
      window.nocturne.validation.list(workspace, 20),
      window.nocturne.semanticIndex.status(workspace),
      window.nocturne.semanticIndex.summary(workspace),
      window.nocturne.engineeringIntelligence.report(workspace),
    ])
    setStatus(nextStatus)
    setSummary(nextSummary)
    setStack(nextStack)
    setValidationRuns(nextValidation)
    setSemanticStatus(nextSemanticStatus)
    setSemanticSummary(nextSemanticSummary)
    setEngineeringReport(nextEngineeringReport)
  }, [authorized, workspace])

  useEffect(() => {
    let mounted = true
    setStatus(null)
    setSummary(null)
    setStack([])
    setSymbols([])
    setValidationRuns([])
    setValidationLoading(false)
    setSemanticStatus(null)
    setSemanticSummary(null)
    setSemanticResults([])
    setSemanticQuery('')
    setSemanticLoading(false)
    setEngineeringReport(null)
    if (!workspace || !authorized) return () => { mounted = false }
    const offStatus = window.nocturne.projectIndex.onStatus((nextStatus) => {
      if (!mounted || nextStatus.workspace !== workspace) return
      setStatus(nextStatus)
      if (['completed', 'cancelled', 'failed'].includes(nextStatus.status)) void refresh().catch((error) => callbacksRef.current.onError(errorMessage(error)))
    })
    const offValidation = window.nocturne.validation.onStatus((run) => {
      if (!mounted || run.workspace !== workspace) return
      setValidationRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 20))
      if (['passed', 'failed', 'cancelled', 'blocked'].includes(run.status)) setValidationLoading(false)
    })
    const offSemanticStatus = window.nocturne.semanticIndex.onStatus((nextStatus) => {
      if (!mounted || nextStatus.workspace !== workspace) return
      setSemanticStatus(nextStatus)
      if (['completed', 'cancelled', 'failed'].includes(nextStatus.status)) void refresh().catch((error) => callbacksRef.current.onError(errorMessage(error)))
    })
    const offEngineering = window.nocturne.engineeringIntelligence.onChanged((report) => {
      if (!mounted || report.snapshot.workspace !== workspace) return
      setEngineeringReport(report)
    })
    void refresh().catch((error) => { if (mounted) callbacksRef.current.onError(errorMessage(error)) })
    return () => { mounted = false; offStatus(); offValidation(); offSemanticStatus(); offEngineering() }
  }, [authorized, refresh, workspace])

  const searchSymbols = useCallback(async () => {
    if (!workspace || !authorized) return
    setLoading(true)
    try {
      setSymbols(await window.nocturne.projectIndex.symbols(workspace, query, 50))
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [authorized, query, workspace])

  const start = useCallback(async () => {
    if (!workspace || !authorized) return
    try { await window.nocturne.projectIndex.start(workspace) } catch (error) { callbacksRef.current.onError(errorMessage(error)) }
  }, [authorized, workspace])

  const cancel = useCallback(async () => {
    if (!workspace || !authorized) return
    try { await window.nocturne.projectIndex.cancel(workspace) } catch (error) { callbacksRef.current.onError(errorMessage(error)) }
  }, [authorized, workspace])

  const retry = useCallback(async () => {
    if (!workspace || !authorized) return
    try { await window.nocturne.projectIndex.retry(workspace) } catch (error) { callbacksRef.current.onError(errorMessage(error)) }
  }, [authorized, workspace])

  const runValidation = useCallback(async (kind: ValidationKind) => {
    if (!workspace || !authorized) return
    setValidationLoading(true)
    try {
      const run = await window.nocturne.validation.run(workspace, kind)
      setValidationRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 20))
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error))
      setValidationLoading(false)
    }
  }, [authorized, workspace])

  const cancelValidation = useCallback(async () => {
    if (!workspace || !authorized) return
    try { await window.nocturne.validation.cancel(workspace) } catch (error) { callbacksRef.current.onError(errorMessage(error)) }
  }, [authorized, workspace])

  const searchSemantic = useCallback(async () => {
    if (!workspace || !authorized || !semanticQuery.trim()) return
    setSemanticLoading(true)
    try {
      setSemanticResults(await window.nocturne.semanticIndex.search({ workspace, query: semanticQuery, limit: 20 }))
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error))
    } finally {
      setSemanticLoading(false)
    }
  }, [authorized, semanticQuery, workspace])

  const startSemantic = useCallback(async () => {
    if (!workspace || !authorized) return
    try { await window.nocturne.semanticIndex.start(workspace) } catch (error) { callbacksRef.current.onError(errorMessage(error)) }
  }, [authorized, workspace])

  const cancelSemantic = useCallback(async () => {
    if (!workspace || !authorized) return
    try { await window.nocturne.semanticIndex.cancel(workspace) } catch (error) { callbacksRef.current.onError(errorMessage(error)) }
  }, [authorized, workspace])

  const detectedStack: DetectedStack | null = summary?.stack ?? null
  return { status, summary, stack, detectedStack, symbols, query, setQuery, loading, refresh, searchSymbols, start, cancel, retry, validationRuns, validationLoading, runValidation, cancelValidation, semanticStatus, semanticSummary, semanticResults, semanticQuery, setSemanticQuery, semanticLoading, searchSemantic, startSemantic, cancelSemantic, engineeringReport }
}
