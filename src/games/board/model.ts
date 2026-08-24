/**
 * A set, dealt as a board.
 *
 * Nothing about a board is stored. The COLUMNS are asked slots, derived from
 * the content; the ROWS are ranks, decided by ordering a column's questions
 * against each other at deal time. There is no `mode` flag, no per-fact
 * category, and no migration to run when an author adds a slot — the same rows
 * simply start qualifying, and a set that gains a `why` gains a column.
 *
 * Three properties, and each is load-bearing rather than decorative:
 *
 * - **One fact is asked once per board.** Columns are slots, so one fact's
 *   questions scatter across several of them, and asking two of them is asking
 *   the same thing twice.
 * - **A board is dealt, then fixed.** Ratings are read once on entry; nothing
 *   re-sorts under a thumb already moving toward a tile.
 * - **At least one column is explain-it**, when the set has one. A board of
 *   names and years is a quiz you can win without understanding anything.
 */

import type { PlayCard } from '../../model/playCards'
import { candidateCategories, chooseCategories, type Category } from './categories'
import { DEFAULT_COLUMNS, DEFAULT_ROWS, dealCells } from './generate'

/** Board rows, at a full deal. */
export const TIERS = [1, 2, 3, 4, 5] as const

/**
 * A row's score.
 *
 * Points come from the ROW, not from the rating. Elo decides which question
 * lands in a cell; the cell is still worth what a Jeopardy cell is worth, so a
 * score means the same thing from one session to the next. The rating stays
 * out of the player's face.
 */
export const pointsFor = (tier: number): number => tier * 100

/**
 * How hard a question is, for ordering a column.
 *
 * Your LOCAL rating where one is known, and it always is for a signed-in
 * reader — the ratings endpoint returns an entry for every question in a set,
 * played or not. A signed-out reader has none at all, so the fallback is the
 * author's `seedTier`. There is deliberately no third case: ratings are
 * all-or-nothing per reader, so a board can never be half-sorted by one
 * measure and half by another.
 */
export type RankBy = (card: PlayCard) => number

export const bySeedTier: RankBy = card => card.seedTier

/** A question placed on the grid. `tier` is its row, decided at deal time. */
export interface BoardClue {
  card: PlayCard
  category: string
  tier: number
}

export interface BoardColumn {
  slot: string
  label: string
  /** row -> clue. A column with fewer questions than rows fills from the top
   *  and leaves the expensive rows empty, which reads as "this category has
   *  less in it" rather than as a hole. */
  cells: Map<number, BoardClue>
}

export interface BoardModel {
  columns: BoardColumn[]
  clueCount: number
  /** Questions not on this board — a fact already asked in another column, or
   *  simply more content than a grid holds. They stay in the deck. */
  unplaced: PlayCard[]
  maxScore: number
}

/** Below this a board is not a board — one column is the deck with points on
 *  it, which is what a plain flashcard set would otherwise get offered. */
export const MIN_COLUMNS = 2

export interface BoardOptions {
  rankBy?: RankBy
  columns?: number
  rows?: number
}

export function buildBoard(cards: PlayCard[], options: BoardOptions = {}): BoardModel {
  const rankBy = options.rankBy ?? bySeedTier
  const rows = options.rows ?? DEFAULT_ROWS
  const available = candidateCategories(cards)

  // Enforced HERE, not in a separate `isPlayable` the caller has to remember
  // to ask. A predicate answering the same question from the same inputs is a
  // second answer waiting to disagree — and it did: the game definition gated
  // on `clueCount === 0` instead, so a set asking only ONE kind of question
  // would have been offered a single-column board, which is the deck with a
  // number on it.
  if (available.length < MIN_COLUMNS) {
    return { columns: [], clueCount: 0, unplaced: cards, maxScore: 0 }
  }

  const categories = chooseCategories(available, options.columns ?? DEFAULT_COLUMNS)

  const placements = dealCells(categories, rows, rankBy)

  const byColumn = new Map<number, PlayCard[]>()
  for (const placement of placements) {
    const held = byColumn.get(placement.column)
    if (held) held.push(placement.card)
    else byColumn.set(placement.column, [placement.card])
  }

  const placed = new Set<string>()
  const columns: BoardColumn[] = []
  let clueCount = 0
  let maxScore = 0

  categories.forEach((category, index) => {
    const chosen = (byColumn.get(index) ?? []).sort(
      // Tie-break on id so two deals of the same set produce the same board —
      // one that reshuffled between renders would be worse than one ordered
      // badly.
      (a, b) => rankBy(a) - rankBy(b) || a.id.localeCompare(b.id)
    )
    const cells = new Map<number, BoardClue>()
    chosen.forEach((card, row) => {
      const tier = row + 1
      cells.set(tier, { card, category: category.label, tier })
      placed.add(card.id)
      clueCount += 1
      maxScore += pointsFor(tier)
    })
    columns.push({ slot: category.slot, label: category.label, cells })
  })

  return {
    columns,
    clueCount,
    unplaced: cards.filter(card => !placed.has(card.id)),
    maxScore
  }
}

/**
 * What a set still needs before it can be a board, phrased for a person.
 *
 * Returns null when nothing does. The answer is almost always the same one: a
 * set of flashcards has only a front and a back, and a board needs questions
 * of DIFFERENT KINDS to make columns out of.
 */
export function missingForBoard(cards: PlayCard[]): string | null {
  if (cards.length === 0) return 'Add some facts first.'
  const candidates = candidateCategories(cards)
  if (candidates.length === 0) {
    return 'These are plain flashcards. Give a fact real slots — who, what, where, when — and each one becomes a column.'
  }
  if (candidates.length < MIN_COLUMNS) {
    return `Only one kind of question here (${candidates[0].label}). A board needs at least ${MIN_COLUMNS} kinds to make columns out of.`
  }
  return null
}

export type { Category }
export { candidateCategories, chooseCategories, labelFor } from './categories'
export { DEFAULT_COLUMNS, DEFAULT_ROWS } from './generate'
