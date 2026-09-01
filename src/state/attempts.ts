/**
 * Getting every answer into the ledger, exactly once.
 *
 * One shared path, called by every game. A mode that forgot to record would
 * look completely healthy — it plays, it grades, it just teaches the system
 * nothing — so the recording lives here rather than in each game, and a new
 * mode gets it by construction.
 *
 * The outbox is the reason this is not a bare `fetch`. Answers are graded on a
 * phone, often on a train, and a send that cannot happen must not cost the
 * answer: it is queued in localStorage and flushed on the next call that
 * succeeds. Two things cannot happen — a POST that fails, and a reader with no
 * identity yet — and both hold rather than drop. Losing one answer is invisible
 * — the rating is simply a little wrong forever — which is precisely why it
 * needs handling rather than a `.catch(() => undefined)`.
 */

import { z } from 'zod'
import type { AttemptInput, CardResult, QuestionRating, QuestionRatingChange } from '../api/types'
import type { StudyClient } from '../api/client'

const OUTBOX_KEY = 'hadoku_study_attempt_outbox'

/**
 * How many held answers to keep.
 *
 * Bounded because localStorage is, and because an outbox that grew forever
 * would eventually throw on write and take the in-memory session down with it.
 * The OLDEST are dropped when it overflows: recent answers describe what you
 * know now, and a month-stale one is the least useful thing in the queue.
 */
export const OUTBOX_LIMIT = 200

/** An answer waiting to be sent, with the set and mode it belongs to. */
export interface PendingAttempt extends AttemptInput {
  setId: string
  game: string
}

/**
 * Anything restored from the device is UNTRUSTED — corrupt, hand-edited, or
 * written by an older bundle. A bad outbox must degrade to an empty one rather
 * than throw on the first grade of a session.
 */
const PendingSchema = z.object({
  setId: z.string(),
  game: z.string(),
  factId: z.string(),
  variantKey: z.string(),
  result: z.enum(['got', 'missed']),
  response: z.string().nullable().optional()
})

export function readOutbox(): PendingAttempt[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(entry => {
      const result = PendingSchema.safeParse(entry)
      return result.success ? [result.data] : []
    })
  } catch {
    // Private-mode Safari, or a corrupt value. Either way there is nothing to
    // send and nothing to fix from here.
    return []
  }
}

export function writeOutbox(pending: PendingAttempt[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(pending.slice(-OUTBOX_LIMIT)))
  } catch {
    // Quota, or private mode. The in-memory session carries on; the answer is
    // lost rather than the game.
  }
}

export function enqueue(pending: PendingAttempt): void {
  writeOutbox([...readOutbox(), pending])
}

/** Everything held for one set, oldest first. */
export const heldFor = (setId: string, outbox = readOutbox()): PendingAttempt[] =>
  outbox.filter(entry => entry.setId === setId)

/** Remove one set's held answers, leaving other sets' alone. */
export function clearHeldFor(setId: string): void {
  writeOutbox(readOutbox().filter(entry => entry.setId !== setId))
}

export interface RecordOptions {
  client: StudyClient
  setId: string
  game: string
  /** Whether the server can hold this reader's answers RIGHT NOW. False means
   *  hold, not discard — see {@link recordAttempt}. */
  enabled: boolean
}

/**
 * Send one answer, flushing anything this set was holding along with it.
 *
 * Held answers ride the SAME request as the new one rather than a separate
 * flush: one round trip, and the server applies them in order, so a streak
 * that spans an offline patch is still a streak.
 *
 * Never throws. A caller is a grade handler in the middle of a game, and a
 * rejected promise there would take the pass down over a bookkeeping failure.
 *
 * A reader with no identity is HELD, not dropped. This used to return early
 * and discard the answer, reasoning that "a signed-out reader has nothing to
 * flush to later, so a queue would grow forever and never drain". Half of that
 * was wrong: `writeOutbox` slices to {@link OUTBOX_LIMIT}, so the queue is
 * bounded at 200 whether it drains or not. The other half undervalued the case
 * it describes — signing in is exactly how a reader stops being signed-out,
 * and the answers graded on the way there are the ones that say what they
 * already knew. Dropping them also contradicted this module's own premise,
 * that a send which cannot happen must not cost the answer.
 *
 * The residual is a shared browser: answers graded anonymously are attributed
 * to whoever signs in next on that device. Bounded by OUTBOX_LIMIT and by what
 * a rating is — a `got`/`missed` on a published set — but it is the same shape
 * as the prefs `anon` scope bug (packages/prefs-client whoami.ts), and if that
 * matters here the fix is theirs: an explicit one-way promotion on sign-in
 * rather than an implicit flush.
 */
export async function recordAttempt(
  options: RecordOptions,
  attempt: AttemptInput
): Promise<QuestionRatingChange[] | null> {
  const { client, setId, game, enabled } = options
  // Held rather than sent: there is no identity to attribute it to yet, and
  // the next enabled send for this set carries it.
  if (!enabled) {
    enqueue({ ...attempt, setId, game })
    return null
  }

  const held = heldFor(setId)
  const batch: AttemptInput[] = [...held, attempt]
  // Cleared BEFORE the send, so a failure re-queues the whole batch below
  // rather than leaving the held copies to be sent a second time.
  clearHeldFor(setId)

  try {
    return await client.recordAttempts(setId, game, batch)
  } catch {
    for (const entry of batch) enqueue({ ...entry, setId, game })
    return null
  }
}

/** Index ratings by the id a game holds, which is `factId:variantKey`. */
export function indexRatings(ratings: QuestionRating[]): Map<string, QuestionRating> {
  return new Map(ratings.map(rating => [`${rating.factId}:${rating.variantKey}`, rating]))
}

export type { CardResult }
