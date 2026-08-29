import { describe, expect, it } from 'vitest'
import { affectsWorkspaceContext } from '../src/domains/workspaces/useWorkspaceSession'

describe('workspace session change classification', () => {
  it('refreshes context files and overflow events', () => {
    expect(affectsWorkspaceContext({ workspace: '/workspace', paths: ['.nocturne/memory.md'], overflow: false, detectedAt: '2026-08-29T12:00:00.000Z' })).toBe(true)
    expect(affectsWorkspaceContext({ workspace: '/workspace', paths: ['src/App.tsx'], overflow: true, detectedAt: '2026-08-29T12:00:00.000Z' })).toBe(true)
  })

  it('ignores unrelated bounded file events', () => {
    expect(affectsWorkspaceContext({ workspace: '/workspace', paths: ['src/App.tsx', 'README.md'], overflow: false, detectedAt: '2026-08-29T12:00:00.000Z' })).toBe(false)
  })
})
