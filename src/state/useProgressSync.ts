/**
 * Keeping the bookmark safe without putting the network in the drill loop.
 *
 * The device copy is written SYNCHRONOUSLY on every grade — that is the copy
 * that survives a lock screen, and writing it costs nothing. The server copy is
 * debounced, because it exists for a different job: picking the set back up on
 * a different device. Putting a round trip between cards to serve that would
 * trade the thing the app is for against a case that tolerates a second of lag.
 *
 * The one moment both must agree is when the page goes away. `visibilitychange`
 * is the only event a mobile browser reliably fires before freezing or
 * discarding a tab — `beforeunload` and `unload` never fire on iOS — so the
 * flush hangs off that plus `pagehide` (the bfcache path), with `keepalive` on
 * the request so it outlives the page.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { StudyClient } from '../api/client'
import { saveLocal, type DrillState } from './drill'

const SERVER_DEBOUNCE_MS = 1200

export function useProgressSync(
  client: StudyClient,
  state: DrillState | null,
  enabled: boolean
): void {
  const latest = useRef<DrillState | null>(state)
  const pending = useRef<number | null>(null)

  latest.current = state

  const cancelPending = useCallback(() => {
    if (pending.current !== null) {
      clearTimeout(pending.current)
      pending.current = null
    }
  }, [])

  const flush = useCallback(() => {
    const current = latest.current
    if (!current) return
    cancelPending()
    void client
      .putProgress(current.setId, { queue: current.queue, results: current.results })
      .catch(() => {
        // The device copy already holds this exact state, so a failed sync costs
        // cross-device continuity and nothing else. Surfacing it would put an
        // error toast over a drill that is working perfectly well.
      })
  }, [cancelPending, client])

  // Device copy: every state change, synchronously, signed in or not.
  useEffect(() => {
    if (state) saveLocal(state)
  }, [state])

  // Server copy: debounced.
  useEffect(() => {
    if (!enabled || !state) return
    cancelPending()
    pending.current = window.setTimeout(flush, SERVER_DEBOUNCE_MS)
    return cancelPending
  }, [cancelPending, enabled, flush, state])

  // The page is going away — spend the write now.
  useEffect(() => {
    if (!enabled) return

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    // `pagehide` fires while the page may still be 'visible', so it must NOT
    // reuse the visibility check — doing so is how a bfcache navigation
    // silently skips the last save.
    const onPageHide = () => flush()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [enabled, flush])
}
