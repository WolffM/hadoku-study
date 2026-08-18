/**
 * Where in the app we are, expressed in the URL.
 *
 * `/study?set=<id>` and `?set=<id>&drill=1`. A query param rather than a path
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
  drilling: boolean
}

function read(): Route {
  const params = new URLSearchParams(window.location.search)
  const setId = params.get('set')
  return { setId: setId && setId !== '' ? setId : null, drilling: params.get('drill') === '1' }
}

function write(route: Route, replace: boolean): void {
  const url = new URL(window.location.href)
  if (route.setId) url.searchParams.set('set', route.setId)
  else url.searchParams.delete('set')
  if (route.setId && route.drilling) url.searchParams.set('drill', '1')
  else url.searchParams.delete('drill')

  const next = `${url.pathname}${url.search}${url.hash}`
  if (replace) window.history.replaceState({}, '', next)
  else window.history.pushState({}, '', next)
}

export function useRoute(): [Route, (next: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(read)

  // The back button must work. Without this, leaving a drill with the browser's
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
