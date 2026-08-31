import { useEffect } from 'react'

export type RendererRenderScope = 'app' | 'chat' | 'composer' | 'agentPanel' | 'agentActivity'

export interface RendererRenderCounts {
  app: number
  chat: number
  composer: number
  agentPanel: number
  agentActivity: number
}

const renderCounts: RendererRenderCounts = {
  app: 0,
  chat: 0,
  composer: 0,
  agentPanel: 0,
  agentActivity: 0,
}

interface RendererDiagnosticsGlobal {
  renderCounts: RendererRenderCounts
}

const rendererGlobal = globalThis as typeof globalThis & { __nocturneRendererDiagnostics?: RendererDiagnosticsGlobal }
const sharedDiagnostics = rendererGlobal.__nocturneRendererDiagnostics ?? { renderCounts }
rendererGlobal.__nocturneRendererDiagnostics = sharedDiagnostics

export function useRendererRenderCounter(scope: RendererRenderScope) {
  useEffect(() => {
    sharedDiagnostics.renderCounts[scope] += 1
  })
}

export function getRendererRenderCounts(): RendererRenderCounts {
  return { ...sharedDiagnostics.renderCounts }
}
