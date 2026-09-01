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

/**
 * Answers per request — the SERVER's cap, mirrored.
 *
 * `MAX_ATTEMPTS_PER_REQUEST` in worker/src/db.ts, and it must not be exceeded
 * rather than merely usually-not: the schema rejects an oversized batch with a
 * 400, and since a rejected send now clears nothing, an outbox that grew past
 * this would fail every flush from then on. A reader with 51 held answers
 * would simply stop syncing, permanently and with nothing to see.
 *
 * OUTBOX_LIMIT is deliberately the larger number — holding is cheap and the
 * backlog drains a batch per grade — so these two cannot be collapsed into one
 * constant. If the server's cap moves, this moves with it.
 */
export const MAX_PER_SEND = 50

/** An answer waiting to be sent, with the set and mode it belongs to. */
export interface PendingAttempt extends AttemptInput {
  /** Required here, unlike on the wire: an entry with no id could not be
   *  cleared by one, so it would be resent for ever. {@link readOutbox}
   *  repairs a legacy entry rather than admitting one. */
  attemptId: string
  setId: string
  game: string
}

/**
 * Anything restored from the device is UNTRUSTED — corrupt, hand-edited, or
 * written by an older bundle. A bad outbox must degrade to an empty one rather
 * than throw on the first grade of a session.
 */
const PendingSchema = z.object({
  // Optional so an outbox written by the bundle that shipped queueing, before
  // ids existed, is REPAIRED on read rather than rejected entry by entry.
  // Those are real answers somebody graded; dropping them to a schema bump
  // would be the same loss this module exists to prevent.
  attemptId: z.string().optional(),
  setId: z.string(),
  game: z.string(),
  factId: z.string(),
  variantKey: z.string(),
  result: z.enum(['got', 'missed']),
  response: z.string().nullable().optional()
})

/**
 * A fresh answer id.
 *
 * `crypto.randomUUID` needs a secure context, which every page serving this
 * app is; the fallback keeps a file:// or an old embedded webview working
 * rather than throwing inside a grade handler. Collision risk on the fallback
 * is irrelevant — the id is scoped to one reader and deduped per user.
 */
export function newAttemptId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function readOutbox(): PendingAttempt[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    let repaired = false
    const entries = parsed.flatMap(entry => {
      const result = PendingSchema.safeParse(entry)
      if (!result.success) return []
      if (result.data.attemptId !== undefined) return [result.data as PendingAttempt]
      // An id minted here has to be PERSISTED, not just returned: the id is
      // how a confirmed send knows what to clear, and one invented afresh on
      // every read would never match, so the entry would be sent forever.
      repaired = true
      return [{ ...result.data, attemptId: newAttemptId() }]
    })
    if (repaired) writeOutbox(entries)
    return entries
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

/**
 * Drop exactly the answers a send CONFIRMED, and nothing else.
 *
 * By id rather than by set, because a grade landing while a request is in
 * flight is ordinary — a fast reader on a slow connection — and clearing the
 * whole set would take that answer with it, unsent and unrecoverable. That is
 * the bug this module had in reverse: it used to clear first and hope.
 */
export function clearSent(ids: readonly string[]): void {
  const sent = new Set(ids)
  writeOutbox(readOutbox().filter(entry => !sent.has(entry.attemptId)))
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
 * Record one answer: write it down, then try to send it.
 *
 * WRITE-AHEAD, AND THAT ORDER IS THE WHOLE GUARANTEE. The answer is durable in
 * localStorage before anything that can fail is attempted, and it is removed
 * only once the server has confirmed it. Delivery is therefore at-least-once
 * and the ledger makes it exactly-once, because every answer carries an
 * `attemptId` the server dedupes on.
 *
 * It used to run the other way — clear the outbox, then send — which is only
 * safe if nothing can interrupt the gap between them. `keepalive` narrows that
 * gap but does not close it: a tab killed mid-flight, or a keepalive body over
 * the 64KB cap, loses a request whose answers are already gone from the
 * device, and the `catch` that would have requeued them never runs because
 * there is no longer a page to run it.
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

  // WRITTEN DOWN BEFORE ANYTHING ELSE HAPPENS TO IT.
  //
  // Every path out of here — disabled, offline, rejected, the tab closing
  // mid-flight — leaves the answer on the device, because it was durable
  // before the first thing that could fail. The previous order cleared the
  // outbox and then sent, which is only safe if nothing can interrupt the gap;
  // a killed tab landed in exactly that gap and the answer was gone from both
  // the device and the wire.
  const pending: PendingAttempt = {
    ...attempt,
    attemptId: attempt.attemptId ?? newAttemptId(),
    setId,
    game
  }
  enqueue(pending)

  // No identity to attribute it to yet. It keeps, and the next enabled send
  // for this set carries it.
  if (!enabled) return null

  // Held answers ride the SAME request as the new one: one round trip, and the
  // server applies them in order, so a streak that spans an offline patch is
  // still a streak.
  //
  // Oldest first, and never more than the server accepts — the remainder stays
  // held and goes with the next grade, so a long backlog drains over several
  // rather than failing as one.
  const batch = heldFor(setId).slice(0, MAX_PER_SEND)

  try {
    const changes = await client.recordAttempts(setId, game, batch)
    // Only now, and only what was actually sent. A duplicate is harmless —
    // every entry carries an `attemptId` the server dedupes on — so the safe
    // failure is sending twice, never clearing early.
    clearSent(batch.map(entry => entry.attemptId))
    return changes
  } catch {
    // Nothing to undo: the batch is still exactly where it was written.
    return null
  }
}

/** Index ratings by the id a game holds, which is `factId:variantKey`. */
export function indexRatings(ratings: QuestionRating[]): Map<string, QuestionRating> {
  return new Map(ratings.map(rating => [`${rating.factId}:${rating.variantKey}`, rating]))
}

export type { CardResult }
