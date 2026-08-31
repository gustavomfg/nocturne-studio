import { useEffect } from 'react'
import { loadSettingsDialog } from '../settings/loadSettingsDialog'

export function useSettingsDialogPreload() {
  useEffect(() => {
    const preload = () => { void loadSettingsDialog() }
    const idle = window.requestIdleCallback?.(preload, { timeout: 1_500 })
    if (idle === undefined) {
      const timer = window.setTimeout(preload, 500)
      return () => window.clearTimeout(timer)
    }
    return () => window.cancelIdleCallback?.(idle)
  }, [])
}
