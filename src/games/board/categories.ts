/**
 * What a board's columns are made of.
 *
 * A category is one ARCHETYPE — a kind of question the author declared. Every
 * question over a fact lives in that fact's column and nowhere else.
 *
 * It used to be the asked SLOT, and that is what made a board feel like the
 * same material four times over: `what` was on 20 of 22 facts in the reference
 * set, `when` on ~17, so four columns drew from one pool and a 4x5 board
 * consumed 20 of the 22 facts. The board WAS the set, sliced four ways.
 *
 * Grouping automatically was tried before declaring was: 16 distinct slot-sets
 * and 16 distinct ask-sets over those 22 facts. Real authored content does not
 * cluster, so the author names the column.
 *
 * The no-repeated-facts rule survives the change and gets easier: one fact
 * belongs to one column, so columns can no longer compete for it.
 */

import type { Archetype } from '../../api/types'
import type { PlayCard } from '../../model/playCards'
import { LEGACY_ANSWER_SLOT, LEGACY_PROMPT_SLOT } from '../../setFile'

/**
 * How a slot reads as a column heading — the FALLBACK, for files written
 * before archetypes existed and for the implicit column.
 *
 * A set that declares archetypes supplies its own labels and never reaches
 * this table. Phrased as a category rather than a question, because a board's
 * headings are labels you scan.
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
  /** The archetype every question in this column shares. `''` is the implicit
   *  archetype a set that declares none puts every fact in. */
  key: string
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
 * what decides whether it can be filled at all. Ties break on the key so two
 * runs of the same set produce the same board.
 *
 * `archetypes` is the set's declarations, used only for the heading — a column
 * is discovered from the facts that claim it, so an archetype nobody uses
 * yields no column rather than an empty one.
 */
export function candidateCategories(
  cards: PlayCard[],
  archetypes?: Archetype[] | null
): Category[] {
  const labels = new Map((archetypes ?? []).map(a => [a.name, a.label]))

  const byArchetype = new Map<string, PlayCard[]>()
  for (const card of cards) {
    if (NOT_A_CATEGORY.has(card.ask)) continue
    // `''` rather than a name nobody chose: a set that declares no archetypes
    // has one column, and giving it a made-up name would put that name in a
    // heading somebody has to read.
    const key = card.archetype ?? ''
    const existing = byArchetype.get(key)
    if (existing) existing.push(card)
    else byArchetype.set(key, [card])
  }

  return [...byArchetype.entries()]
    .map(([key, group]) => ({
      key,
      label: headingFor(key, group, labels),
      cards: group,
      factCount: new Set(group.map(card => card.factId)).size,
      hasOpen: group.some(card => card.open)
    }))
    .sort((a, b) => b.factCount - a.factCount || a.key.localeCompare(b.key))
}

/**
 * A column's heading.
 *
 * The author's `label` when they declared one — this is the whole reason the
 * built-in table below is a FALLBACK now rather than the vocabulary. A set
 * about scripture calls its column whatever it likes.
 *
 * Two fallbacks, for files that predate archetypes: a column whose questions
 * all ask the same slot is named for that slot, which is what every board did
 * before; anything else is named for the set, because a mixed implicit column
 * is the whole deck and saying so is honest.
 */
function headingFor(key: string, group: PlayCard[], labels: Map<string, string>): string {
  const declared = labels.get(key)
  if (declared) return declared
  const asked = new Set(group.map(card => card.ask))
  if (asked.size === 1) return labelFor([...asked][0])
  return 'Everything'
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
