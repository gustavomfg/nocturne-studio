import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { suggestionIdentity, type ReviewComparisonItem, type Suggestion, type SuggestionInput, type SuggestionReconciliation, type SuggestionStatus } from '../../shared/suggestions'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

type EncodedSuggestion = Omit<Suggestion, 'affectedFiles' | 'expectedBenefits' | 'evidence' | 'history'> & {
  affectedFiles: string
  expectedBenefits: string
  evidence: string
}

/** Owns review suggestions, reconciliation and their decision history. */
export class SuggestionRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  list(conversationId: string): Suggestion[] {
    const rows = this.database.prepare(`${suggestionSelect}
      WHERE conversation_id=? AND status IN ('new','in-analysis','accepted','deferred')
      ORDER BY updated_at DESC`).all(conversationId) as EncodedSuggestion[]
    return this.decode(rows)
  }

  page(conversationId: string, offset = 0, limit = 50) {
    const rows = this.database.prepare(`${suggestionSelect}
      WHERE conversation_id=? AND status IN ('new','in-analysis','accepted','deferred')
      ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(
      conversationId,
      limit + 1,
      offset,
    ) as EncodedSuggestion[]
    return { items: this.decode(rows.slice(0, limit)), hasMore: rows.length > limit }
  }

  get(id: string, conversationId?: string): Suggestion | null {
    const row = this.database.prepare(`${suggestionSelect}
      WHERE id=?${conversationId ? ' AND conversation_id=?' : ''}`).get(
      ...(conversationId ? [id, conversationId] : [id]),
    ) as EncodedSuggestion | undefined
    return row ? this.decode([row])[0] : null
  }

  add(conversationId: string, workspaceId: string, value: SuggestionInput): Suggestion {
    const now = new Date().toISOString()
    const decisionId = randomUUID()
    const row: Suggestion = {
      id: randomUUID(),
      workspaceId,
      conversationId,
      ...value,
      evidence: value.evidence ?? [],
      confidence: value.confidence ?? 60,
      source: value.source ?? 'Análise do agente',
      responsible: value.responsible ?? 'Agente de revisão',
      status: 'new',
      createdAt: now,
      updatedAt: now,
      history: [{ id: decisionId, status: 'new', result: null, createdAt: now }],
    }
    this.transactions.run('suggestions.add', () => {
      this.database.prepare(`INSERT INTO suggestions(
        id,workspace_id,conversation_id,title,description,reasoning,category,severity,
        affected_files,proposed_changes,expected_benefits,complexity,risk,evidence,
        confidence,source,responsible,status,created_at,updated_at
      ) VALUES(
        @id,@workspaceId,@conversationId,@title,@description,@reasoning,@category,@severity,
        @affectedFiles,@proposedChanges,@expectedBenefits,@complexity,@risk,@evidence,
        @confidence,@source,@responsible,@status,@createdAt,@updatedAt
      )`).run({
        ...row,
        affectedFiles: JSON.stringify(row.affectedFiles),
        expectedBenefits: JSON.stringify(row.expectedBenefits),
        evidence: JSON.stringify(row.evidence),
      })
      this.database.prepare(`INSERT INTO suggestion_decisions(
        id,suggestion_id,status,result,created_at
      ) VALUES(?,?,?,?,?)`).run(decisionId, row.id, 'new', null, now)
    })
    return row
  }

  reconcile(
    conversationId: string,
    workspaceId: string,
    values: SuggestionInput[],
  ): SuggestionReconciliation {
    return this.transactions.run('suggestions.reconcile', () => {
      const history = this.listHistory(conversationId)
      const byIdentity = new Map<string, Suggestion>()
      const activeBefore = new Map<string, Suggestion>()
      for (const suggestion of history) {
        const identity = suggestionIdentity(suggestion)
        const existing = byIdentity.get(identity)
        const suggestionIsActive = isActiveStatus(suggestion.status)
        const existingIsActive = existing ? isActiveStatus(existing.status) : false
        if (!existing || (!existingIsActive && suggestionIsActive)
          || (existing.status === 'new' && suggestion.status === 'accepted')) {
          byIdentity.set(identity, suggestion)
        }
        if (suggestionIsActive && !activeBefore.has(identity)) {
          activeBefore.set(identity, suggestion)
        }
      }

      const seen = new Set<string>()
      const newSuggestions: ReviewComparisonItem[] = []
      const persistentSuggestions: ReviewComparisonItem[] = []
      const severityChanges: SuggestionReconciliation['comparison']['severityChanges'] = []
      const suggestions = values.map((value) => {
        const identity = suggestionIdentity(value)
        seen.add(identity)
        const existing = byIdentity.get(identity)
        if (!existing) {
          const created = this.add(conversationId, workspaceId, value)
          byIdentity.set(identity, created)
          newSuggestions.push(comparisonItem(created))
          return created
        }
        if (!isActiveStatus(existing.status)) return existing
        persistentSuggestions.push(comparisonItem(existing))
        if (existing.severity !== value.severity) {
          severityChanges.push({
            id: existing.id,
            title: existing.title,
            from: existing.severity,
            to: value.severity,
          })
        }
        if (!['new', 'in-analysis', 'deferred'].includes(existing.status)) return existing
        const updatedAt = new Date().toISOString()
        this.database.prepare(`UPDATE suggestions SET
          title=@title,description=@description,reasoning=@reasoning,category=@category,
          severity=@severity,affected_files=@affectedFiles,proposed_changes=@proposedChanges,
          expected_benefits=@expectedBenefits,complexity=@complexity,risk=@risk,
          evidence=@evidence,confidence=@confidence,source=@source,responsible=@responsible,
          updated_at=@updatedAt
          WHERE id=@id AND conversation_id=@conversationId
            AND status IN ('new','in-analysis','deferred')`).run({
          ...value,
          id: existing.id,
          conversationId,
          affectedFiles: JSON.stringify(value.affectedFiles),
          expectedBenefits: JSON.stringify(value.expectedBenefits),
          evidence: JSON.stringify(value.evidence ?? []),
          confidence: value.confidence ?? 60,
          source: value.source ?? 'Análise do agente',
          responsible: value.responsible ?? 'Agente de revisão',
          updatedAt,
        })
        const updated = this.get(existing.id, conversationId) as Suggestion
        byIdentity.set(identity, updated)
        return updated
      })

      const resolvedSuggestions: ReviewComparisonItem[] = []
      for (const [identity, suggestion] of activeBefore) {
        if (seen.has(identity) || !['new', 'in-analysis'].includes(suggestion.status)) continue
        const resolved = this.setStatus(
          suggestion.id,
          'resolved',
          'A sugestão não reapareceu na revisão estruturada atual.',
        )
        resolvedSuggestions.push(comparisonItem(resolved))
      }
      return {
        suggestions,
        comparison: {
          reviewedAt: new Date().toISOString(),
          newSuggestions,
          persistentSuggestions,
          resolvedSuggestions,
          severityChanges,
        },
      }
    })
  }

  setStatus(id: string, status: SuggestionStatus, result?: string): Suggestion {
    return this.transactions.run('suggestions.setStatus', () => {
      const updatedAt = new Date().toISOString()
      const current = this.database.prepare('SELECT status FROM suggestions WHERE id=?')
        .get(id) as { status: SuggestionStatus } | undefined
      if (!current) throw new Error('Sugestão não encontrada.')
      const allowed: Record<SuggestionStatus, SuggestionStatus[]> = {
        new: ['in-analysis', 'accepted', 'rejected', 'resolved', 'deferred', 'invalid'],
        'in-analysis': ['accepted', 'rejected', 'resolved', 'deferred', 'invalid'],
        accepted: ['resolved', 'rejected', 'deferred', 'invalid'],
        deferred: ['in-analysis', 'accepted', 'rejected', 'resolved', 'invalid'],
        rejected: [],
        resolved: [],
        invalid: [],
      }
      if (current.status === status) return this.get(id) as Suggestion
      if (!allowed[current.status].includes(status)) {
        throw new Error(`Transição de sugestão inválida: ${current.status} → ${status}.`)
      }
      const normalizedResult = result?.slice(0, 20_000) ?? null
      const changed = this.database.prepare(`UPDATE suggestions
        SET status=?,result=?,updated_at=? WHERE id=?`).run(
        status,
        normalizedResult,
        updatedAt,
        id,
      )
      if (!changed.changes) throw new Error('Sugestão não encontrada.')
      this.database.prepare(`INSERT INTO suggestion_decisions(
        id,suggestion_id,status,result,created_at
      ) VALUES(?,?,?,?,?)`).run(randomUUID(), id, status, normalizedResult, updatedAt)
      const row = this.database.prepare(
        'SELECT conversation_id conversationId FROM suggestions WHERE id=?',
      ).get(id) as { conversationId: string }
      return this.get(id, row.conversationId) as Suggestion
    })
  }

  private listHistory(conversationId: string): Suggestion[] {
    const rows = this.database.prepare(`${suggestionSelect}
      WHERE conversation_id=? ORDER BY updated_at DESC`).all(conversationId) as EncodedSuggestion[]
    return this.decode(rows)
  }

  private decode(rows: EncodedSuggestion[]): Suggestion[] {
    if (!rows.length) return []
    const identifiers = rows.map((row) => row.id)
    const placeholders = identifiers.map(() => '?').join(',')
    const decisions = this.database.prepare(`SELECT
      id,suggestion_id suggestionId,status,result,created_at createdAt
      FROM suggestion_decisions WHERE suggestion_id IN (${placeholders})
      ORDER BY created_at,rowid`).all(...identifiers) as Array<{
      id: string
      suggestionId: string
      status: SuggestionStatus
      result: string | null
      createdAt: string
    }>
    const history = new Map<string, Suggestion['history']>()
    for (const decision of decisions) {
      const entries = history.get(decision.suggestionId) ?? []
      entries.push({
        id: decision.id,
        status: decision.status,
        result: decision.result,
        createdAt: decision.createdAt,
      })
      history.set(decision.suggestionId, entries)
    }
    return decodeSuggestionRows(rows).map((suggestion) => ({
      ...suggestion,
      history: history.get(suggestion.id) ?? [{
        id: `legacy-${suggestion.id}`,
        status: 'new',
        result: null,
        createdAt: suggestion.createdAt,
      }],
    }))
  }
}

const suggestionSelect = `SELECT id,workspace_id workspaceId,conversation_id conversationId,
  title,description,reasoning,category,severity,affected_files affectedFiles,
  proposed_changes proposedChanges,expected_benefits expectedBenefits,complexity,risk,
  evidence,confidence,source,responsible,status,created_at createdAt,updated_at updatedAt
  FROM suggestions`

function decodeSuggestionRows(rows: EncodedSuggestion[]) {
  return rows.map((row) => ({
    ...row,
    affectedFiles: JSON.parse(row.affectedFiles) as string[],
    expectedBenefits: JSON.parse(row.expectedBenefits) as string[],
    evidence: JSON.parse(row.evidence) as Suggestion['evidence'],
    history: [],
  }))
}

function isActiveStatus(status: SuggestionStatus) {
  return status === 'new' || status === 'in-analysis' || status === 'accepted' || status === 'deferred'
}

function comparisonItem(suggestion: Suggestion): ReviewComparisonItem {
  return {
    id: suggestion.id,
    title: suggestion.title,
    severity: suggestion.severity,
  }
}
