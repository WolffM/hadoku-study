/**
 * How a set is going, for the person who reads it and the person who wrote it.
 *
 * Two questions, one panel, because they are answered by the same data and a
 * set's owner is usually both people:
 *
 * - **Hardest for you right now** — your highest-rated questions, among the
 *   ones you have actually answered. This is what a local rating IS, distilled;
 *   there is no need to re-derive it from the attempt ledger when the rating is
 *   already the running answer to exactly this question.
 * - **Not where you put it** — questions whose GLOBAL rating has drifted well
 *   away from the tier their author chose. The one number an author can act on:
 *   not the rating, which means nothing alone, but the disagreement.
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

  const { answered, hardest, drifted } = useMemo(() => {
    const withCard = ratings
      .map(rating => ({ rating, card: byId.get(`${rating.factId}:${rating.variantKey}`) }))
      .filter(
        (entry): entry is { rating: QuestionRating; card: PlayCard } => entry.card !== undefined
      )

    const played = withCard.filter(entry => entry.rating.yourPlays > 0)

    return {
      answered: played.reduce((total, entry) => total + entry.rating.yourPlays, 0),
      hardest: [...played].sort((a, b) => b.rating.local - a.rating.local).slice(0, SHORTLIST),
      drifted: withCard
        .map(entry => ({
          ...entry,
          drift: driftFromSeed(entry.rating.global, seedRatingFor(entry.card.seedTier))
        }))
        .filter((entry): entry is typeof entry & { drift: number } => entry.drift !== null)
        .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
        .slice(0, SHORTLIST)
    }
  }, [byId, ratings])

  if (answered === 0 && drifted.length === 0) return null

  return (
    <section className="standing">
      {answered > 0 && (
        <>
          <p className="standing__head">
            You&rsquo;ve answered <strong>{answered}</strong> {answered === 1 ? 'time' : 'times'}{' '}
            here.
          </p>
          {hardest.length > 0 && (
            <>
              <p className="standing__sub">Hardest for you right now</p>
              <ul className="standing__list">
                {hardest.map(entry => (
                  <li key={entry.card.id} className="standing__item">
                    <span className="standing__item-front">{entry.card.front}</span>
                    <span className="standing__item-answer">{entry.card.back}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {isOwner && drifted.length > 0 && (
        <>
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
        </>
      )}
    </section>
  )
}
