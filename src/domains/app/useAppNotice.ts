import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_NOTICE_DURATION_MS = 3_200

export function useAppNotice(durationMs = DEFAULT_NOTICE_DURATION_MS) {
  const [notice, setNotice] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const dismissNotice = useCallback(() => {
    setNotice(null)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const notify = useCallback((message: string) => {
    setNotice(message)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setNotice(null)
      timerRef.current = null
    }, durationMs)
  }, [durationMs])

  useEffect(() => dismissNotice, [dismissNotice])

  return { notice, notify, dismissNotice }
}
