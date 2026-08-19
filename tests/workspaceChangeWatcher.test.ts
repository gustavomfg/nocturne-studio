import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChangeWatcher } from '../electron/workspaces/WorkspaceChangeWatcher'

interface FakeWatchHandle {
  close(): void
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'ready', listener: () => void): this
  on(event: 'all', listener: (eventType: string, filename: string) => void): this
}

describe('monitoramento de mudanças no workspace', () => {
  afterEach(() => vi.useRealTimers())

  it('agrupa caminhos, ignora diretórios gerados e limita o lote', async () => {
    vi.useFakeTimers()
    const emitted = vi.fn()
    const captured: { listener: ((eventType: string, filename: string | null) => void) | null } = { listener: null }
    const close = vi.fn()
    const handle: FakeWatchHandle = {
      close,
      on: vi.fn((event, listener) => {
        if (event === 'all') captured.listener = listener as (eventType: string, filename: string | null) => void
        if (event === 'ready') (listener as () => void)()
        return handle
      }),
    }
    const watcher = new WorkspaceChangeWatcher(emitted, (_workspace: string, nextListener) => {
      captured.listener = nextListener
      return handle
    }, 50, async () => new Map())
    await watcher.start('/tmp/nocturne-watched-project')
    captured.listener?.('change', 'src/App.tsx')
    captured.listener?.('rename', 'src/App.tsx')
    captured.listener?.('change', '.nocturne/memory.md')
    captured.listener?.('change', 'node_modules/package/index.js')
    for (let index = 0; index < 105; index += 1) captured.listener?.('change', `src/file-${index}.ts`)
    vi.advanceTimersByTime(50)

    expect(emitted).toHaveBeenCalledOnce()
    expect(emitted.mock.calls[0][0]).toMatchObject({
      workspace: '/tmp/nocturne-watched-project',
      paths: expect.arrayContaining(['.nocturne/memory.md', 'src/App.tsx']),
      overflow: true,
    })
    expect(emitted.mock.calls[0][0].paths).toHaveLength(100)
    expect(emitted.mock.calls[0][0].paths).not.toContain('node_modules/package/index.js')
    await watcher.stop()
    expect(close).toHaveBeenCalledOnce()
  })

  it('só resolve quando o backend sinaliza readiness', async () => {
    let ready: (() => void) | null = null
    const handle: FakeWatchHandle = {
      close: vi.fn(),
      on: vi.fn((event, listener) => {
        if (event === 'ready') ready = () => (listener as () => void)()
        return handle
      }),
    }
    const watcher = new WorkspaceChangeWatcher(vi.fn(), () => handle, 250, async () => new Map())
    let settled = false
    const start = watcher.start('/tmp/nocturne-watched-project').then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    const notifyReady = ready as unknown as (() => void)
    if (!notifyReady) throw new Error('ready listener não foi registrado')
    notifyReady()
    await start
    expect(settled).toBe(true)
    await watcher.stop()
  })

  it('reconcilia alterações ocorridas durante a inicialização', async () => {
    vi.useFakeTimers()
    const emitted = vi.fn()
    const close = vi.fn()
    const handle: FakeWatchHandle = {
      close,
      on: vi.fn((_event, listener) => {
        if (_event === 'ready') (listener as () => void)()
        return handle
      }),
    }
    const snapshots = [
      new Map([
        ['existing.txt', 'file:1:1:1'],
        ['removed.txt', 'file:1:1:1'],
      ]),
      new Map([
        ['existing.txt', 'file:2:2:1'],
        ['created.txt', 'file:1:1:1'],
      ]),
    ]
    const watcher = new WorkspaceChangeWatcher(emitted, () => handle, 25, async () => snapshots.shift() ?? new Map())

    await watcher.start('/tmp/nocturne-watched-project')
    vi.advanceTimersByTime(25)

    expect(emitted).toHaveBeenCalledOnce()
    expect(emitted.mock.calls[0][0]).toMatchObject({
      paths: ['created.txt', 'existing.txt', 'removed.txt'],
      overflow: false,
    })
    await watcher.stop()
    expect(close).toHaveBeenCalledOnce()
  })

  it('normaliza eventos absolutos e filename ausente sem perder o lote semântico', async () => {
    vi.useFakeTimers()
    const emitted = vi.fn()
    const captured: { listener: ((eventType: string, filename: string | null) => void) | null } = { listener: null }
    const handle: FakeWatchHandle = {
      close: vi.fn(),
      on: vi.fn((event, listener) => {
        if (event === 'all') captured.listener = listener as (eventType: string, filename: string | null) => void
        if (event === 'ready') (listener as () => void)()
        return handle
      }),
    }
    const watcher = new WorkspaceChangeWatcher(emitted, (_workspace, nextListener) => {
      captured.listener = nextListener
      return handle
    }, 25, async () => new Map())
    await watcher.start('/tmp/nocturne-watched-project')

    captured.listener?.('add', '/tmp/nocturne-watched-project/created.txt')
    captured.listener?.('unlink', '/tmp/nocturne-watched-project/created.txt')
    captured.listener?.('change', null)
    vi.advanceTimersByTime(25)

    expect(emitted).toHaveBeenCalledOnce()
    expect(emitted.mock.calls[0][0]).toMatchObject({ paths: ['created.txt'], overflow: true })
    await watcher.stop()
  })

  it('encerra deterministicamente quando o observador nativo falha', async () => {
    const emitted = vi.fn()
    const captured: { errorListener: ((error: Error) => void) | null } = { errorListener: null }
    const close = vi.fn()
    const handle: FakeWatchHandle = {
      close,
      on: vi.fn((_event, listener) => {
        if (_event === 'error') captured.errorListener = listener as (error: Error) => void
        if (_event === 'ready') (listener as () => void)()
        return handle
      }),
    }
    const watcher = new WorkspaceChangeWatcher(emitted, () => handle, 250, async () => new Map())
    await watcher.start('/tmp/nocturne-watched-project')

    captured.errorListener?.(new Error('limite do sistema'))

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/tmp/nocturne-watched-project',
      paths: [],
      error: 'Monitoramento interrompido: limite do sistema',
    }))
    expect(close).toHaveBeenCalledOnce()
  })
})
