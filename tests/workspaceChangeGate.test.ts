import { describe, expect, it, vi } from 'vitest'
import { WorkspaceChangeGate } from '../electron/change-control/WorkspaceChangeGate'

describe('WorkspaceChangeGate', () => {
  it('segura eventos enquanto a mudança aguarda decisão e libera o lote agregado', () => {
    const release = vi.fn()
    const gate = new WorkspaceChangeGate(release)
    gate.begin('/tmp/gate-workspace')
    expect(gate.enqueue({ workspace: '/tmp/gate-workspace', paths: ['a.ts'], overflow: false, detectedAt: '2026-09-03T00:00:00.000Z' })).toBe(true)
    expect(gate.enqueue({ workspace: '/tmp/gate-workspace', paths: ['b.ts', 'a.ts'], overflow: true, detectedAt: '2026-09-03T00:00:01.000Z' })).toBe(true)
    expect(release).not.toHaveBeenCalled()
    gate.release('/tmp/gate-workspace')
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ paths: ['a.ts', 'b.ts'], overflow: true }))
    expect(gate.isHeld('/tmp/gate-workspace')).toBe(false)
  })
})
