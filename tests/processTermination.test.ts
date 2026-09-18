import { describe, expect, it, vi } from 'vitest'
import { terminateProcess, usesDedicatedProcessGroup } from '../electron/runtime/ProcessTermination'

describe('supervisão de processos', () => {
  it('direciona TERM ao grupo de processo dedicado no POSIX', () => {
    const child = { pid: 4242, kill: vi.fn(() => true) }
    if (process.platform === 'win32') {
      expect(terminateProcess(child as never, 'SIGTERM')).toBe('parent-only')
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(usesDedicatedProcessGroup()).toBe(false)
      return
    }

    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true as never)
    try {
      expect(terminateProcess(child as never, 'SIGTERM')).toBe('process-group')
      expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM')
      expect(child.kill).not.toHaveBeenCalled()
      expect(usesDedicatedProcessGroup()).toBe(true)
    } finally {
      kill.mockRestore()
    }
  })
})
