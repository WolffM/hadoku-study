/**
 * A fact's questions, flattened into the things a game actually shows.
 *
 * Games walk QUESTIONS, not facts. A fact with four slots is four different
 * things to get right, they are graded separately and rated separately, and a
 * mode that walked facts would ask about Worms once and call it known.
 *
 * Nothing is derived here. The server already resolved every variant — prompt,
 * answer, key — and this only pairs each one with the fact it came from and
 * gives it an id a queue can hold.
 */

import type { FactAttrs, StudyFact, StudyVariant } from '../api/types'

/** One question, ready to render. */
export interface PlayCard {
  /** `factId:variantKey`. Unique across a set, stable across a rephrasing, and
   *  the key a queue, a results map or a bookmark holds. */
  id: string
  factId: string
  variantKey: string
  /** The question. */
  front: string
  /** The answer. */
  back: string
  /** Shown after the answer — the "why". Belongs to the fact, so every
   *  question over that fact carries it. */
  detail: string | null
  /** Slots shown as context beside the question. Empty when the prompt already
   *  is the shown side, which is every migrated flashcard. */
  given: StudyVariant['given']
  open: boolean
  seedTier: number
  /** The fact's game bag, carried through so a game can read its own namespace
   *  without holding on to the fact. */
  attrs: FactAttrs | null
}

export const playCardId = (factId: string, variantKey: string): string => `${factId}:${variantKey}`

export function toPlayCards(facts: StudyFact[]): PlayCard[] {
  return facts.flatMap(fact =>
    fact.variants.map(variant => ({
      id: playCardId(fact.id, variant.key),
      factId: fact.id,
      variantKey: variant.key,
      front: variant.prompt,
      back: variant.answer,
      detail: fact.detail ?? null,
      given: variant.given,
      open: variant.open,
      seedTier: variant.seedTier,
      attrs: fact.attrs ?? null
    }))
  )
}

/** How many questions a set holds, from facts already in hand. */
export const countQuestions = (facts: StudyFact[]): number =>
  facts.reduce((total, fact) => total + fact.variants.length, 0)
