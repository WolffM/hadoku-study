/**
 * Where a set has drifted from what its author intended.
 *
 * OWNER ONLY, and one question: which questions has play rated well away from
 * the tier their author chose. That disagreement is the one number an author
 * can act on — a rating alone means nothing without something to compare it
 * to.
 *
 * It used to also tell the READER how many times they had answered and which
 * questions were hardest for them. That was commentary nobody asked for: a
 * reader who just played knows they played, and "hardest for you" is the deck
 * they are already looking at, reordered. Removed 2026-09-02.
 *
 * Nothing renders until something has been played. An empty panel promising
 * insight later is worse than no panel.
 */

import { useMemo } from 'react'
import type { QuestionRating } from '../api/types'
import type { PlayCard } from '../model/playCards'
import { driftFromSeed, seedRatingFor } from '../state/session'

export interface StandingProps {
  cards: PlayCard[]
  ratings: QuestionRating[]
  /** Whether to offer the author's half. Owners only — it is about the set,
   *  not about the reader. */
  isOwner: boolean
}

/** How many to name. A longer list stops being a shortlist and becomes the set
 *  again, which the reader can already see. */
const SHORTLIST = 3

export function Standing({ cards, ratings, isOwner }: StandingProps) {
  const byId = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards])

  const drifted = useMemo(() => {
    const withCard = ratings
      .map(rating => ({ rating, card: byId.get(`${rating.factId}:${rating.variantKey}`) }))
      .filter(
        (entry): entry is { rating: QuestionRating; card: PlayCard } => entry.card !== undefined
      )

    return withCard
      .map(entry => ({
        ...entry,
        drift: driftFromSeed(entry.rating.global, seedRatingFor(entry.card.seedTier))
      }))
      .filter((entry): entry is typeof entry & { drift: number } => entry.drift !== null)
      .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
      .slice(0, SHORTLIST)
  }, [byId, ratings])

  if (!isOwner || drifted.length === 0) return null

  return (
    <section className="standing">
      <p className="standing__sub">Not where you put them</p>
      <ul className="standing__list">
        {drifted.map(entry => (
          <li key={entry.card.id} className="standing__item">
            <span className="standing__item-front">{entry.card.front}</span>
            <span className="standing__item-answer">
              {entry.drift > 0 ? 'playing harder' : 'playing easier'} than its{' '}
              {entry.card.seedTier * 100} tier
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
