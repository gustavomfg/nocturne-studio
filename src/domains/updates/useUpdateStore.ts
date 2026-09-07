import { useEffect } from 'react'
import { create } from 'zustand'
import type { UpdateState } from '../../../shared/updates'

interface UpdateStoreState {
  state: UpdateState | null
  initialized: boolean
  connectionError: string | null
  check(): Promise<UpdateState | null>
  download(): Promise<UpdateState | null>
  retry(): Promise<UpdateState | null>
  install(): Promise<UpdateState | null>
  mount(): void
  unmount(): void
}

let bridgeCleanup: (() => void) | null = null
let hydrationPromise: Promise<void> | null = null
let mountedConsumers = 0

const useUpdateStore = create<UpdateStoreState>((set) => ({
  state: null,
  initialized: false,
  connectionError: null,
  check: () => invokeCommand(window.nocturne.updates.check, set),
  download: () => invokeCommand(window.nocturne.updates.download, set),
  retry: () => invokeCommand(window.nocturne.updates.retry, set),
  install: () => invokeCommand(window.nocturne.updates.install, set),
  mount() {
    mountedConsumers += 1
    if (!bridgeCleanup) {
      try {
        bridgeCleanup = window.nocturne.updates.onStateChanged((state) => set({ state, initialized: true, connectionError: null }))
      } catch (error) {
        set({ initialized: true, connectionError: readableError(error) })
        return
      }
    }
    if (hydrationPromise) return
    hydrationPromise = window.nocturne.updates.getState()
      .then((state) => { set({ state, initialized: true, connectionError: null }) })
      .catch((error) => { set({ initialized: true, connectionError: readableError(error) }) })
      .finally(() => { hydrationPromise = null })
  },
  unmount() {
    mountedConsumers = Math.max(0, mountedConsumers - 1)
    if (mountedConsumers > 0) return
    bridgeCleanup?.()
    bridgeCleanup = null
    hydrationPromise = null
    set({ initialized: false })
  },
}))

export function useUpdates() {
  const state = useUpdateStore((current) => current.state)
  const initialized = useUpdateStore((current) => current.initialized)
  const connectionError = useUpdateStore((current) => current.connectionError)
  const check = useUpdateStore((current) => current.check)
  const download = useUpdateStore((current) => current.download)
  const retry = useUpdateStore((current) => current.retry)
  const install = useUpdateStore((current) => current.install)

  useEffect(() => {
    useUpdateStore.getState().mount()
    return () => useUpdateStore.getState().unmount()
  }, [])

  return { state, initialized, connectionError, check, download, retry, install }
}

async function invokeCommand(command: () => Promise<UpdateState>, set: (value: Partial<UpdateStoreState>) => void) {
  try {
    const state = await command()
    set({ state, connectionError: null })
    return state
  } catch (error) {
    set({ connectionError: readableError(error) })
    return null
  }
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível comunicar com o serviço de atualização.'
}
