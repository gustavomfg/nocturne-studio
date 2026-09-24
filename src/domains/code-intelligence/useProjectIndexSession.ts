import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetectedStack, ProjectIndexStatus, ProjectIndexSummary, ProjectSymbol, StackEvidence, ValidationKind, ValidationRun } from '../../../shared/codeIntelligence'
import type { SemanticIndexStatus, SemanticIndexSummary, SemanticSearchResult } from '../../../shared/semanticIndex'
import type { EngineeringHealthReport } from '../../../shared/engineeringIntelligence'
import { COLLECTION_PAGE_LIMITS } from '../../../shared/constants'
import { errorMessage } from '../../shared/format'

interface ProjectIndexSessionOptions {
  workspace: string
  authorized: boolean
  onError(message: string): void
}

interface SessionIdentity {
  workspace: string
  authorized: boolean
  generation: number
  mounted: boolean
}

function isCurrentSession(ref: { current: SessionIdentity }, token: { workspace: string; generation: number }) {
  return ref.current.authorized
    && ref.current.mounted
    && ref.current.workspace === token.workspace
    && ref.current.generation === token.generation
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
  const [validationHasMore, setValidationHasMore] = useState(false)
  const [validationPageLoading, setValidationPageLoading] = useState(false)
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null)
  const [semanticSummary, setSemanticSummary] = useState<SemanticIndexSummary | null>(null)
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([])
  const [semanticQuery, setSemanticQuery] = useState('')
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [engineeringReport, setEngineeringReport] = useState<EngineeringHealthReport | null>(null)
  const callbacksRef = useRef({ onError })
  callbacksRef.current = { onError }
  const sessionRef = useRef<SessionIdentity>({ workspace, authorized, generation: 0, mounted: true })
  if (sessionRef.current.workspace !== workspace || sessionRef.current.authorized !== authorized) {
    sessionRef.current = {
      workspace,
      authorized,
      generation: sessionRef.current.generation + 1,
      mounted: true,
    }
  }
  const symbolsRequestRef = useRef(0)
  const semanticRequestRef = useRef(0)
  const validationRunsRef = useRef<ValidationRun[]>([])
  const validationOffsetRef = useRef(0)
  const validationHasMoreRef = useRef(false)
  const validationPageLoadingRef = useRef(false)
  const validationPageRequestRef = useRef(0)

  const applyValidationRuns = useCallback((incoming: ValidationRun[], prependNew: boolean, preferIncoming = false) => {
    const next = mergeValidationRuns(validationRunsRef.current, incoming, prependNew, preferIncoming)
    validationRunsRef.current = next
    validationOffsetRef.current = next.length
    setValidationRuns(next)
    return next
  }, [])

  const refresh = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    const validationRequest = ++validationPageRequestRef.current
    validationPageLoadingRef.current = false
    setValidationPageLoading(false)
    const [nextStatus, nextSummary, nextStack, nextValidation, nextSemanticStatus, nextSemanticSummary, nextEngineeringReport] = await Promise.all([
      window.nocturne.projectIndex.status(workspace),
      window.nocturne.projectIndex.summary(workspace),
      window.nocturne.projectIndex.stack(workspace),
      window.nocturne.validation.page(workspace, 0, COLLECTION_PAGE_LIMITS.validation),
      window.nocturne.semanticIndex.status(workspace),
      window.nocturne.semanticIndex.summary(workspace),
      window.nocturne.engineeringIntelligence.report(workspace),
    ])
    if (!isCurrentSession(sessionRef, token)) return
    setStatus(nextStatus)
    setSummary(nextSummary)
    setStack(nextStack)
    if (validationPageRequestRef.current === validationRequest) {
      const validationWasPaged = validationOffsetRef.current > nextValidation.items.length
      const previousHasMore = validationHasMoreRef.current
      applyValidationRuns(nextValidation.items, true)
      validationHasMoreRef.current = validationWasPaged ? previousHasMore : nextValidation.hasMore
      setValidationHasMore(validationHasMoreRef.current)
      validationPageLoadingRef.current = false
      setValidationPageLoading(false)
    }
    setSemanticStatus(nextSemanticStatus)
    setSemanticSummary(nextSemanticSummary)
    setEngineeringReport(nextEngineeringReport)
  }, [applyValidationRuns, authorized, workspace])

  useEffect(() => {
    let mounted = true
    sessionRef.current.mounted = true
    setStatus(null)
    setSummary(null)
    setStack([])
    setSymbols([])
    validationRunsRef.current = []
    validationOffsetRef.current = 0
    validationHasMoreRef.current = false
    validationPageLoadingRef.current = false
    validationPageRequestRef.current += 1
    setValidationRuns([])
    setValidationLoading(false)
    setValidationHasMore(false)
    setValidationPageLoading(false)
    setSemanticStatus(null)
    setSemanticSummary(null)
    setSemanticResults([])
    setSemanticQuery('')
    setSemanticLoading(false)
    setEngineeringReport(null)
    if (!workspace || !authorized) return () => { mounted = false; sessionRef.current.mounted = false }
    const offStatus = window.nocturne.projectIndex.onStatus((nextStatus) => {
      if (!mounted || nextStatus.workspace !== workspace) return
      setStatus(nextStatus)
      if (['completed', 'cancelled', 'failed'].includes(nextStatus.status)) void refresh().catch((error) => { if (mounted) callbacksRef.current.onError(errorMessage(error)) })
    })
    const offValidation = window.nocturne.validation.onStatus((run) => {
      if (!mounted || run.workspace !== workspace) return
      applyValidationRuns([run], true, true)
      if (['passed', 'failed', 'cancelled', 'blocked'].includes(run.status)) setValidationLoading(false)
    })
    const offSemanticStatus = window.nocturne.semanticIndex.onStatus((nextStatus) => {
      if (!mounted || nextStatus.workspace !== workspace) return
      setSemanticStatus(nextStatus)
      if (['completed', 'cancelled', 'failed'].includes(nextStatus.status)) void refresh().catch((error) => { if (mounted) callbacksRef.current.onError(errorMessage(error)) })
    })
    const offEngineering = window.nocturne.engineeringIntelligence.onChanged((report) => {
      if (!mounted || report.snapshot.workspace !== workspace) return
      setEngineeringReport(report)
    })
    void refresh().catch((error) => { if (mounted) callbacksRef.current.onError(errorMessage(error)) })
    return () => { mounted = false; sessionRef.current.mounted = false; offStatus(); offValidation(); offSemanticStatus(); offEngineering() }
  }, [applyValidationRuns, authorized, refresh, workspace])

  const loadMoreValidations = useCallback(async () => {
    if (!workspace || !authorized || !validationHasMoreRef.current || validationPageLoadingRef.current) return
    const token = { workspace, generation: sessionRef.current.generation }
    const requestId = ++validationPageRequestRef.current
    const offset = validationOffsetRef.current
    validationPageLoadingRef.current = true
    setValidationPageLoading(true)
    try {
      const page = await window.nocturne.validation.page(workspace, offset, COLLECTION_PAGE_LIMITS.validation)
      if (!isCurrentSession(sessionRef, token) || validationPageRequestRef.current !== requestId) return
      const runs = applyValidationRuns(page.items, false)
      validationHasMoreRef.current = page.hasMore
      setValidationHasMore(page.hasMore)
      validationOffsetRef.current = runs.length
    } catch (error) {
      if (isCurrentSession(sessionRef, token) && validationPageRequestRef.current === requestId) callbacksRef.current.onError(errorMessage(error))
    } finally {
      if (isCurrentSession(sessionRef, token) && validationPageRequestRef.current === requestId) {
        validationPageLoadingRef.current = false
        setValidationPageLoading(false)
      }
    }
  }, [applyValidationRuns, authorized, workspace])

  const searchSymbols = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    const requestId = symbolsRequestRef.current + 1
    symbolsRequestRef.current = requestId
    setLoading(true)
    try {
      const nextSymbols = await window.nocturne.projectIndex.symbols(workspace, query, 50)
      if (isCurrentSession(sessionRef, token) && symbolsRequestRef.current === requestId) setSymbols(nextSymbols)
    } catch (error) {
      if (isCurrentSession(sessionRef, token) && symbolsRequestRef.current === requestId) callbacksRef.current.onError(errorMessage(error))
    } finally {
      if (isCurrentSession(sessionRef, token) && symbolsRequestRef.current === requestId) setLoading(false)
    }
  }, [authorized, query, workspace])

  const start = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    try { await window.nocturne.projectIndex.start(workspace) } catch (error) {
      if (isCurrentSession(sessionRef, token)) callbacksRef.current.onError(errorMessage(error))
    }
  }, [authorized, workspace])

  const cancel = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    try { await window.nocturne.projectIndex.cancel(workspace) } catch (error) {
      if (isCurrentSession(sessionRef, token)) callbacksRef.current.onError(errorMessage(error))
    }
  }, [authorized, workspace])

  const retry = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    try { await window.nocturne.projectIndex.retry(workspace) } catch (error) {
      if (isCurrentSession(sessionRef, token)) callbacksRef.current.onError(errorMessage(error))
    }
  }, [authorized, workspace])

  const runValidation = useCallback(async (kind: ValidationKind) => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    setValidationLoading(true)
    try {
      const run = await window.nocturne.validation.run(workspace, kind)
      if (isCurrentSession(sessionRef, token)) applyValidationRuns([run], true, true)
    } catch (error) {
      if (isCurrentSession(sessionRef, token)) {
        callbacksRef.current.onError(errorMessage(error))
        setValidationLoading(false)
      }
    }
  }, [applyValidationRuns, authorized, workspace])

  const cancelValidation = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    try { await window.nocturne.validation.cancel(workspace) } catch (error) {
      if (isCurrentSession(sessionRef, token)) callbacksRef.current.onError(errorMessage(error))
    }
  }, [authorized, workspace])

  const searchSemantic = useCallback(async () => {
    if (!workspace || !authorized || !semanticQuery.trim()) return
    const token = { workspace, generation: sessionRef.current.generation }
    const requestId = semanticRequestRef.current + 1
    semanticRequestRef.current = requestId
    setSemanticLoading(true)
    try {
      const nextResults = await window.nocturne.semanticIndex.search({ workspace, query: semanticQuery, limit: 20 })
      if (isCurrentSession(sessionRef, token) && semanticRequestRef.current === requestId) setSemanticResults(nextResults)
    } catch (error) {
      if (isCurrentSession(sessionRef, token) && semanticRequestRef.current === requestId) callbacksRef.current.onError(errorMessage(error))
    } finally {
      if (isCurrentSession(sessionRef, token) && semanticRequestRef.current === requestId) setSemanticLoading(false)
    }
  }, [authorized, semanticQuery, workspace])

  const startSemantic = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    try { await window.nocturne.semanticIndex.start(workspace) } catch (error) {
      if (isCurrentSession(sessionRef, token)) callbacksRef.current.onError(errorMessage(error))
    }
  }, [authorized, workspace])

  const cancelSemantic = useCallback(async () => {
    if (!workspace || !authorized) return
    const token = { workspace, generation: sessionRef.current.generation }
    try { await window.nocturne.semanticIndex.cancel(workspace) } catch (error) {
      if (isCurrentSession(sessionRef, token)) callbacksRef.current.onError(errorMessage(error))
    }
  }, [authorized, workspace])

  const detectedStack: DetectedStack | null = summary?.stack ?? null
  return { status, summary, stack, detectedStack, symbols, query, setQuery, loading, refresh, searchSymbols, start, cancel, retry, validationRuns, validationLoading, validationHasMore, validationPageLoading, loadMoreValidations, runValidation, cancelValidation, semanticStatus, semanticSummary, semanticResults, semanticQuery, setSemanticQuery, semanticLoading, searchSemantic, startSemantic, cancelSemantic, engineeringReport }
}

function mergeValidationRuns(current: ValidationRun[], incoming: ValidationRun[], prependNew: boolean, preferIncoming: boolean) {
  const incomingById = new Map(incoming.map((run) => [run.id, run]))
  const currentIds = new Set(current.map((run) => run.id))
  const newRuns = incoming.filter((run) => !currentIds.has(run.id))
  const existing = preferIncoming ? current.map((run) => incomingById.get(run.id) ?? run) : current
  return prependNew ? [...newRuns, ...existing] : [...existing, ...newRuns]
}
