/**
 * What one sitting did.
 *
 * The recap is the only place a reader ever sees a rating, and it is worth
 * being careful about which number that is. Two rules here, both because the
 * obvious version is subtly wrong:
 *
 * - The RESULT kept is the FIRST one. The drill re-queues a missed question
 *   until you get it, so the last outcome of every question in a completed
 *   pass is "got" — a recap built from the last outcome would congratulate you
 *   on a pass you struggled through.
 * - The DELTA is accumulated across every attempt, and the RATING is the
 *   latest. A question you missed twice and then got moved three times, and
 *   the honest report is where it ended up and how far it travelled.
 */

import type { CardResult, QuestionRatingChange } from '../api/types'
import type { PlayCard } from '../model/playCards'

export interface Movement {
  card: PlayCard
  /** How it went the FIRST time this sitting — see above. */
  result: CardResult
  /** Your rating now. Null when the answer never reached the server, which is
   *  the normal signed-out case and the offline one. */
  local: number | null
  /** How far this sitting moved it, summed over repeats. */
  localDelta: number
}

/**
 * Fold one graded answer into the log.
 *
 * `changes` is whatever `recordAttempt` returned — null when nothing was sent
 * or the send failed. A movement is still recorded in that case, because the
 * recap's job is to say what you got wrong, and that is true whether or not a
 * rating moved.
 */
export function noteAnswer(
  log: Movement[],
  card: PlayCard,
  result: CardResult,
  changes: QuestionRatingChange[] | null
): Movement[] {
  const change = changes?.find(entry => `${entry.factId}:${entry.variantKey}` === card.id) ?? null
  const existing = log.find(movement => movement.card.id === card.id)

  const next: Movement = {
    card,
    result: existing?.result ?? result,
    local: change?.local ?? existing?.local ?? null,
    localDelta: (existing?.localDelta ?? 0) + (change?.localDelta ?? 0)
  }

  return existing
    ? log.map(movement => (movement.card.id === card.id ? next : movement))
    : [...log, next]
}

export interface Recap {
  got: number
  missed: number
  /** Questions to come back to — missed first, hardest-won first within that.
   *  Empty when the sitting was clean, which is the point. */
  review: Movement[]
  /** Whether any rating actually moved. False for a signed-out reader, and for
   *  one whose answers never reached the server. */
  rated: boolean
}

/** How many to name. More than a handful stops being a list and becomes the
 *  set again. */
export const REVIEW_LIMIT = 5

export function recap(log: Movement[]): Recap {
  const missed = log.filter(movement => movement.result === 'missed')
  return {
    got: log.length - missed.length,
    missed: missed.length,
    review: [...missed]
      // Biggest riser first: the ones that moved most are the ones this sitting
      // learnt the most about, and they are what you would come back to.
      .sort((a, b) => b.localDelta - a.localDelta || a.card.front.localeCompare(b.card.front))
      .slice(0, REVIEW_LIMIT),
    rated: log.some(movement => movement.local !== null)
  }
}

/**
 * Where a question sits now, relative to where its author put it.
 *
 * The one number an AUTHOR wants: not the rating, which means nothing on its
 * own, but whether play has disagreed with the tier they chose. Returns null
 * when it has not moved enough to be worth saying — a rating wanders by a few
 * points constantly, and reporting that as news would train people to ignore
 * it.
 */
export const DRIFT_THRESHOLD = 60

export function driftFromSeed(rating: number, seedRating: number): number | null {
  const drift = rating - seedRating
  return Math.abs(drift) < DRIFT_THRESHOLD ? null : drift
}

/** Mirrors the worker's `seedRating`. Hint-only: it turns a stored tier into
 *  the number a drift is measured against, and being a little off would make
 *  an editor badge slightly wrong, never a stored value. */
export const seedRatingFor = (seedTier: number): number => 1200 + (seedTier - 3) * 100
