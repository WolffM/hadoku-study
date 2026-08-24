/**
 * What a board's columns are made of.
 *
 * A category is the SLOT a column asks. "Name that year" is every question
 * whose answer is a `when`; "Who said it" is every `who`. That is not a
 * relabelling of the old per-fact category string — it is the thing that makes
 * a board generatable at all, because it can be computed from content nobody
 * had to tag.
 *
 * It also makes the no-repeated-facts rule matter for the first time. Under
 * per-fact categories every question about one fact shared a column, so a fact
 * could only ever appear once anyway. Asking by slot scatters one fact's
 * questions across four different columns, and "where did Luther meet Charles
 * V" now genuinely can collide with "who did Luther meet at Worms".
 */

import type { PlayCard } from '../../model/playCards'
import { LEGACY_ANSWER_SLOT, LEGACY_PROMPT_SLOT } from '../../setFile'

/**
 * How a slot reads as a column heading.
 *
 * Phrased as a category rather than as a question — a board's headings are
 * labels you scan, not prompts you answer. An unknown slot falls back to its
 * own name, which is right for the free-form ones: a set about Guild Wars maps
 * gets a column called "map", and that is exactly what it should say.
 */
const LABELS: Record<string, string> = {
  who: 'Who was it?',
  what: 'What happened?',
  where: 'Name that place',
  when: 'Name that year',
  why: 'Why it mattered',
  how: 'How did it work?',
  quote: 'What were the words?',
  term: 'Name the term',
  definition: 'What does it mean?'
}

const titleCase = (slot: string): string =>
  slot.replace(/[-_]+/g, ' ').replace(/^./, first => first.toUpperCase())

export const labelFor = (slot: string): string => LABELS[slot] ?? titleCase(slot)

/**
 * Slots that name the two halves of a flashcard rather than a kind of question.
 *
 * A migrated v1 card has slots `prompt` and `answer`, and a column headed
 * "Answer" is not a category — it is the whole deck with a number on it. A set
 * that has never been given real slots therefore yields no columns and simply
 * is not offered as a board, which is the honest answer.
 */
const NOT_A_CATEGORY = new Set<string>([LEGACY_PROMPT_SLOT, LEGACY_ANSWER_SLOT])

export interface Category {
  /** The asked slot every question in this column shares. */
  slot: string
  label: string
  /** Questions available for this column, one entry per question — the same
   *  fact may appear more than once and is deduped when the board is filled. */
  cards: PlayCard[]
  /** Distinct facts behind them. This, not `cards.length`, is what a column
   *  can actually contribute: one fact may be asked only once per board. */
  factCount: number
  /** Whether this column can offer a question you explain rather than name. */
  hasOpen: boolean
}

/**
 * Every column a set could offer, richest first.
 *
 * Ordered by how many distinct FACTS could fill the column, because that is
 * what decides whether it can be filled at all. Ties break on the slot name so
 * two runs of the same set produce the same board.
 */
export function candidateCategories(cards: PlayCard[]): Category[] {
  const bySlot = new Map<string, PlayCard[]>()
  for (const card of cards) {
    if (NOT_A_CATEGORY.has(card.ask)) continue
    const existing = bySlot.get(card.ask)
    if (existing) existing.push(card)
    else bySlot.set(card.ask, [card])
  }

  return [...bySlot.entries()]
    .map(([slot, group]) => ({
      slot,
      label: labelFor(slot),
      cards: group,
      factCount: new Set(group.map(card => card.factId)).size,
      hasOpen: group.some(card => card.open)
    }))
    .sort((a, b) => b.factCount - a.factCount || a.slot.localeCompare(b.slot))
}

/**
 * Pick the columns to play, keeping at least one you have to talk your way
 * through.
 *
 * Richest-first, except that an explain-it column is guaranteed a seat when
 * one exists — a board of nothing but names and years is a quiz you can win
 * without understanding anything, which is the opposite of the point. It
 * displaces the WEAKEST otherwise-chosen column, so the guarantee costs the
 * board as little coverage as possible.
 */
export function chooseCategories(candidates: Category[], want: number): Category[] {
  const chosen = candidates.slice(0, want)
  if (chosen.length === 0 || chosen.some(category => category.hasOpen)) return chosen

  const open = candidates.find(category => category.hasOpen)
  if (!open) return chosen
  return [...chosen.slice(0, -1), open]
}
