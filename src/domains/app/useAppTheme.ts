import { useEffect } from 'react'
import type { AppSettings } from '../../types'

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

export function useAppTheme(theme: AppSettings['theme']) {
  useEffect(() => {
    const root = document.documentElement
    const nextTheme = theme === 'light' ? 'light' : 'dark'
    const currentTheme = root.dataset.theme || 'dark'
    if (currentTheme === nextTheme) {
      root.dataset.theme = nextTheme
      return
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const transitionDocument = document as ViewTransitionDocument
    const applyTheme = () => { root.dataset.theme = nextTheme }
    if (!reducedMotion && typeof transitionDocument.startViewTransition === 'function') {
      try {
        const transition = transitionDocument.startViewTransition(applyTheme)
        void transition.finished.catch(() => undefined)
        return
      } catch {
        // Fall back for engines that expose the API but cannot start a transition.
      }
    }
    applyTheme()
  }, [theme])
}
