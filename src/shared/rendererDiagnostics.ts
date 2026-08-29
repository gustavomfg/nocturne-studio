import { useEffect } from 'react'

export type RendererRenderScope = 'app' | 'chat' | 'composer' | 'agentPanel'

export interface RendererRenderCounts {
  app: number
  chat: number
  composer: number
  agentPanel: number
}

const renderCounts: RendererRenderCounts = {
  app: 0,
  chat: 0,
  composer: 0,
  agentPanel: 0,
}

export function useRendererRenderCounter(scope: RendererRenderScope) {
  useEffect(() => {
    renderCounts[scope] += 1
  })
}

export function getRendererRenderCounts(): RendererRenderCounts {
  return { ...renderCounts }
}
