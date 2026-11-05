import { useEffect, useState } from 'react'

export const ORCHESTRA_OBSERVATION_INTERVAL_MS = 3_000

/** Poll only the visible surface; the caller serializes requests and preserves old observations. */
export function useOrchestraObservation(
  refresh: () => Promise<void>,
  enabled: boolean,
  intervalMs = ORCHESTRA_OBSERVATION_INTERVAL_MS
): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onVisible = (): void => {
      const next = document.visibilityState !== 'hidden'
      setVisible(next)
      if (next && enabled) {
        void refresh()
      }
    }
    const timer = window.setInterval(() => {
      if (enabled && document.visibilityState !== 'hidden') {
        void refresh()
      }
    }, intervalMs)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, intervalMs, refresh])
  return enabled && visible
}
