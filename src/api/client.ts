/**
 * Talking to `/study/api`.
 *
 * Same-origin through edge-router, which resolves the session cookie to a key
 * and stamps the tier and userId on the way through. So no key ever touches
 * this bundle — `credentials: 'same-origin'` is the whole auth story from
 * here.
 */

import { getSessionId } from './session'
import type { CardInput, StoredProgress, StudySet, StudySetDetail } from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  /** A set that does not exist, and a private set belonging to someone else,
   *  are the same answer on purpose. Callers render one "not found" for both. */
  get isMissing(): boolean {
    return this.status === 404
  }

  get isForbidden(): boolean {
    return this.status === 403
  }
}

interface WrappedOk<T> {
  success: true
  data: T
}

interface WrappedErr {
  success: false
  error: string
  message?: string
}

function headers(): HeadersInit {
  const out: Record<string, string> = { Accept: 'application/json' }
  // Cookie auth is the primary channel; the header is the fallback for clients
  // whose cookies are blocked cross-origin (the Capacitor APK). Harmless when
  // the cookie works — edge-router prefers the cookie.
  const sessionId = getSessionId()
  if (sessionId) out['X-Session-Id'] = sessionId
  return out
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...headers(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  })

  let body: WrappedOk<T> | WrappedErr | null = null
  try {
    body = (await res.json()) as WrappedOk<T> | WrappedErr
  } catch {
    // A non-JSON body means the request never reached the worker — an edge
    // error page, or the 503 stub before the worker was deployed. Surface the
    // status rather than a JSON parse error, which would send whoever reads
    // the console looking in entirely the wrong place.
    throw new ApiError(res.status, `${res.status} ${res.statusText}`)
  }

  if (!res.ok || !body || body.success === false) {
    const err = body && body.success === false ? (body.message ?? body.error) : res.statusText
    throw new ApiError(res.status, err || 'Request failed')
  }

  return body.data
}

export function createClient(base: string) {
  const trimmed = base.replace(/\/$/, '')

  return {
    listMySets: () => request<{ sets: StudySet[] }>(trimmed, '/sets').then(d => d.sets),

    listPublished: () =>
      request<{ sets: StudySet[] }>(trimmed, '/sets/published').then(d => d.sets),

    getSet: (id: string) =>
      request<{ set: StudySetDetail }>(trimmed, `/sets/${encodeURIComponent(id)}`).then(d => d.set),

    createSet: (input: { title: string; description?: string | null; cards?: CardInput[] }) =>
      request<{ set: StudySetDetail }>(trimmed, '/sets', {
        method: 'POST',
        body: JSON.stringify(input)
      }).then(d => d.set),

    updateSet: (
      id: string,
      patch: { title?: string; description?: string | null; published?: boolean }
    ) =>
      request<{ set: StudySet }>(trimmed, `/sets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      }).then(d => d.set),

    deleteSet: (id: string) =>
      request<{ setId: string }>(trimmed, `/sets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    replaceCards: (id: string, cards: CardInput[]) =>
      request<{ cards: StudySetDetail['cards'] }>(
        trimmed,
        `/sets/${encodeURIComponent(id)}/cards`,
        { method: 'PUT', body: JSON.stringify({ cards }) }
      ).then(d => d.cards),

    getProgress: (id: string) =>
      request<{ progress: StoredProgress | null }>(
        trimmed,
        `/sets/${encodeURIComponent(id)}/progress`
      ).then(d => d.progress),

    /**
     * `keepalive` so a save fired from `visibilitychange` survives the page
     * being frozen or discarded — which on a phone is the COMMON case, not the
     * edge case: locking the screen mid-session is exactly when the bookmark
     * matters most, and a plain fetch would be cancelled on the spot.
     */
    putProgress: (id: string, progress: Pick<StoredProgress, 'queue' | 'results'>) =>
      request<{ progress: StoredProgress }>(trimmed, `/sets/${encodeURIComponent(id)}/progress`, {
        method: 'PUT',
        body: JSON.stringify(progress),
        keepalive: true
      }).then(d => d.progress),

    clearProgress: (id: string) =>
      request<{ setId: string }>(trimmed, `/sets/${encodeURIComponent(id)}/progress`, {
        method: 'DELETE',
        keepalive: true
      })
  }
}

export type StudyClient = ReturnType<typeof createClient>
