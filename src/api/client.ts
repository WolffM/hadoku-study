/**
 * Talking to `/study/api`.
 *
 * Same-origin through edge-router, which resolves the session cookie to a key
 * and stamps the tier and userId on the way through. So no key ever touches
 * this bundle — `credentials: 'same-origin'` is the whole auth story from
 * here.
 */

import { logger } from '@wolffm/logger/client'
import { getSessionId } from './session'
import type {
  AttemptInput,
  FactInput,
  QuestionRating,
  QuestionRatingChange,
  StoredProgress,
  StudySet,
  StudySetDetail
} from './types'

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

/**
 * One call to the API, logged on the way out and the way back.
 *
 * The failure path is the point. Every caller of this turns a rejection into a
 * message on screen and nothing else, so before this a 500 from the worker
 * left no trace anywhere in the browser — the user saw "Could not save the
 * set" and there was nothing to look at afterwards. `apiRequest`/`apiResponse`
 * are the logger's own helpers, so these land as typed api events rather than
 * as strings.
 */
async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const startedAt = performance.now()
  logger.apiRequest(method, path)

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...headers(),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    })
  } catch (cause) {
    // The request never completed — offline, DNS, a cancelled keepalive flush.
    // Distinct from an error STATUS, and the only place it is distinguishable.
    logger.error('Study API request failed to complete', {
      method,
      path,
      durationMs: Math.round(performance.now() - startedAt),
      cause: cause instanceof Error ? cause.message : String(cause)
    })
    throw new ApiError(0, 'Could not reach the server')
  }

  const durationMs = Math.round(performance.now() - startedAt)
  // Only the successful half goes through `apiResponse`, because the helper
  // escalates every non-2xx to ERROR — which is wrong here twice over: a 404
  // is the DESIGNED answer for a private set and a 403 for a signed-out
  // writer, and pairing it with the line below logged one event twice at two
  // different levels. Failures are reported once, at a level that matches, by
  // the block further down.
  if (res.ok) logger.apiResponse(method, path, res.status, { durationMs })

  let body: WrappedOk<T> | WrappedErr | null = null
  try {
    body = (await res.json()) as WrappedOk<T> | WrappedErr
  } catch {
    // A non-JSON body means the request never reached the worker — an edge
    // error page, or the 503 stub before the worker was deployed. Surface the
    // status rather than a JSON parse error, which would send whoever reads
    // the console looking in entirely the wrong place.
    logger.error('Study API returned a non-JSON body', {
      method,
      path,
      status: res.status,
      durationMs
    })
    throw new ApiError(res.status, `${res.status} ${res.statusText}`)
  }

  if (!res.ok || !body || body.success === false) {
    const err = body && body.success === false ? (body.message ?? body.error) : res.statusText
    // A 403 or 404 here is usually the system working as designed — signed
    // out, or a private set — so only a server fault is logged at error level.
    // A wall of expected 404s would bury the ones that matter.
    const context = { method, path, status: res.status, durationMs, message: err }
    if (res.status >= 500) logger.error('Study API request failed', context)
    else logger.warn('Study API request refused', context)
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

    createSet: (input: {
      title: string
      description?: string | null
      facts?: FactInput[]
      published?: boolean
    }) =>
      request<{ set: StudySetDetail }>(trimmed, '/sets', {
        method: 'POST',
        body: JSON.stringify(input)
      }).then(d => d.set),

    /**
     * Write a whole set — metadata and every fact — in ONE request.
     *
     * The editor holds the complete set, so saving it in two pieces could
     * half-land: the rename succeeds, the content write fails, and the set is
     * left claiming to be something it is not. The worker does both in one D1
     * transaction.
     *
     * Send each fact back with the `id` it arrived with. An id the set already
     * owns is kept, and the ratings hanging off it survive; drop it and the
     * server mints a new one, silently discarding that question's history.
     */
    replaceSet: (
      id: string,
      input: {
        title: string
        description?: string | null
        facts: FactInput[]
        published?: boolean
      }
    ) =>
      request<{ set: StudySetDetail }>(trimmed, `/sets/${encodeURIComponent(id)}`, {
        method: 'PUT',
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

    /**
     * How every question in a set stands, played or not.
     *
     * Fetched once when a game starts rather than per question: the ordering a
     * board renders has to be settled BEFORE the grid is drawn, or the tiles
     * reshuffle under a thumb already moving toward one.
     */
    /**
     * The set as one portable document.
     *
     * Fetched rather than built from the set already in memory, so there is
     * exactly ONE idea of what an export contains. A second implementation
     * here would eventually disagree with the server's, and the symptom would
     * be a UI export that behaves differently from a scripted one for reasons
     * nobody could see.
     *
     * Bare, not wrapped — so `request` cannot be used, and this reads the body
     * directly.
     */
    getFile: async (id: string): Promise<unknown> => {
      const path = `/sets/${encodeURIComponent(id)}/file`
      logger.apiRequest('GET', path)
      const res = await fetch(`${trimmed}${path}`, {
        credentials: 'same-origin',
        headers: headers()
      })
      if (!res.ok) {
        logger.warn('Study API refused the set file', { path, status: res.status })
        throw new ApiError(res.status, `${res.status} ${res.statusText}`)
      }
      logger.apiResponse('GET', path, res.status)
      return (await res.json()) as unknown
    },

    getRatings: (id: string) =>
      request<{ ratings: QuestionRating[] }>(
        trimmed,
        `/sets/${encodeURIComponent(id)}/ratings`
      ).then(d => d.ratings),

    /**
     * Record answers and get back what they did to the ratings.
     *
     * One per answer in the normal case. `keepalive` because a grade fired as
     * a phone locks is exactly the one worth not losing, and a plain fetch
     * would be cancelled when the page freezes.
     */
    recordAttempts: (id: string, game: string, attempts: AttemptInput[]) =>
      request<{ ratings: QuestionRatingChange[] }>(
        trimmed,
        `/sets/${encodeURIComponent(id)}/attempts`,
        {
          method: 'POST',
          body: JSON.stringify({ game, attempts }),
          keepalive: true
        }
      ).then(d => d.ratings),

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
