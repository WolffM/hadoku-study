/**
 * Where in the app we are, expressed in the URL.
 *
 * `/study?set=<id>` and `?set=<id>&play=<game>`. A query param rather than a
 * path
 * segment because this bundle mounts at the single static route `/study` — the
 * host page has no subpaths to hand us, and this is the same shape `/meet` uses
 * for its `?e=` links.
 *
 * The URL is the point, not an implementation detail: publishing a set exists
 * so it can be handed to someone, and a link that opens straight into that set
 * is what makes that work.
 */

import { useCallback, useEffect, useState } from 'react'

export interface Route {
  setId: string | null
  /**
   * The game being played, by id — or null for the set's own page.
   *
   * A game ID rather than a fixed union, so adding a mode is a registry entry
   * and nothing else. An id the registry does not know resolves to null, which
   * is the set page: an old link to a retired game lands somewhere sensible
   * rather than on a blank screen.
   */
  playing: string | null
}

function read(): Route {
  const params = new URLSearchParams(window.location.search)
  const setId = params.get('set')
  // `drill=1` is still honoured. Those links are already in the wild, and a
  // shared study link must not break just because modes became pluggable.
  const playing = params.get('drill') === '1' ? 'drill' : (params.get('play') ?? null)
  return {
    setId: setId && setId !== '' ? setId : null,
    playing: playing && playing !== '' ? playing : null
  }
}

function write(route: Route, replace: boolean): void {
  const url = new URL(window.location.href)
  if (route.setId) url.searchParams.set('set', route.setId)
  else url.searchParams.delete('set')

  url.searchParams.delete('drill')
  url.searchParams.delete('play')
  if (route.setId && route.playing) url.searchParams.set('play', route.playing)

  const next = `${url.pathname}${url.search}${url.hash}`
  if (replace) window.history.replaceState({}, '', next)
  else window.history.pushState({}, '', next)
}

export function useRoute(): [Route, (next: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(read)

  // The back button must work. Without this, leaving a game with the browser's
  // back gesture — the natural thing to do on a phone — would change the URL
  // and leave the app showing the card it was on.
  useEffect(() => {
    const onPop = () => setRoute(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route, replace = false) => {
    write(next, replace)
    setRoute(next)
  }, [])

  return [route, navigate]
}
