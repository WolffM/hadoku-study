/**
 * A set, read as a board.
 *
 * Board-ness is DERIVED, never stored. A question whose fact carries a
 * category can sit on the board; one whose fact does not is drill-only. There
 * is no `mode` flag to drift out of step with the content it describes, and no
 * migration to run when an author finishes tagging a set — the same rows
 * simply start qualifying.
 *
 * The asymmetry is deliberate and runs one way: every board is already a deck,
 * because a clue is a question with an answer. A deck becomes a board only
 * once someone has done the authoring.
 *
 * Two halves, from two places. The COLUMN comes from the game's own namespace
 * in the fact's attrs, because a column label is genuinely board-specific.
 * The ROW is not stored at all — it is a RANK, assigned here by ordering a
 * column's questions against each other. That is what makes a board respond to
 * play: as your ratings drift, the same questions re-sort themselves, and a
 * question you have started getting right slides down the board on its own.
 */

import type { PlayCard } from '../../model/playCards'

/** Board rows. Five is what a Jeopardy board is, and what fits a phone. */
export const TIERS = [1, 2, 3, 4, 5] as const

/**
 * A row's score.
 *
 * Points come from the ROW, not from the rating. Elo decides which question
 * lands in a cell; the cell is still worth what a Jeopardy cell is worth, so a
 * score means the same thing from one session to the next and a total out of
 * 2500 is comparable. The rating stays out of the player's face.
 */
export const pointsFor = (tier: number): number => tier * 100

/** This game's namespace in a fact's `attrs` bag. Matches the definition's id. */
export const BOARD_NAMESPACE = 'board'

export interface BoardAttrs {
  category: string
}

/** A question placed on the grid. `tier` is its row, decided here. */
export interface BoardClue {
  card: PlayCard
  category: string
  tier: number
}

/**
 * Read this game's attributes off a question's fact.
 *
 * Defensive about shape because the bag passes unknown namespaces through
 * unvalidated — a `board` key written by an older or hand-edited file may be
 * anything at all, and a question whose attrs do not parse is simply not a
 * clue.
 */
export function readBoardAttrs(card: PlayCard): BoardAttrs | null {
  const raw = card.attrs?.[BOARD_NAMESPACE]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { category } = raw as Record<string, unknown>
  if (typeof category !== 'string' || category.trim() === '') return null
  return { category: category.trim() }
}

/** Whether a question can appear on a board at all. */
export const isClue = (card: PlayCard): boolean => readBoardAttrs(card) !== null

/**
 * How hard a question is, for ordering a column.
 *
 * Your LOCAL rating where one is known, and it always is for a signed-in
 * reader — the ratings endpoint returns an entry for every question in a set,
 * played or not. A signed-out reader has none at all, so the fallback is the
 * author's `seedTier`, which is the same ordering the board had before ratings
 * existed. There is deliberately no third case: ratings are all-or-nothing per
 * reader, so a board can never be half-sorted by one measure and half by
 * another.
 */
export type RankBy = (card: PlayCard) => number

export const bySeedTier: RankBy = card => card.seedTier

export interface BoardModel {
  /** Column labels, in first-appearance order — which is the author's order,
   *  since questions arrive in fact position order. */
  categories: string[]
  /** category -> row -> the clue. A board with holes is a normal in-progress
   *  state, not an error. */
  cells: Map<string, Map<number, BoardClue>>
  clueCount: number
  /** Questions that did not make the grid — untagged, or squeezed out of a
   *  full column. They stay drillable. */
  unplaced: PlayCard[]
  maxScore: number
}

/**
 * Pick `count` items spanning a sorted list.
 *
 * Taking the first five of a long column would build a board out of its five
 * easiest questions, which is not a board. Spreading across the range keeps the
 * ladder a ladder however much content a category has.
 *
 * Phase 4 replaces this with a real generator that balances columns against
 * each other; until then, spanning one column at a time is the honest version.
 */
export function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items]
  const picked = new Set<number>()
  for (let i = 0; i < count; i += 1) {
    picked.add(Math.round((i * (items.length - 1)) / (count - 1)))
  }
  // Rounding can collide on short lists (six items into five rows), which would
  // silently render a four-row column. Backfill in order so the count always
  // holds.
  for (let i = 0; picked.size < count && i < items.length; i += 1) picked.add(i)
  return [...picked].sort((a, b) => a - b).map(index => items[index])
}

export function buildBoard(cards: PlayCard[], rankBy: RankBy = bySeedTier): BoardModel {
  const categories: string[] = []
  const grouped = new Map<string, PlayCard[]>()
  const unplaced: PlayCard[] = []

  for (const card of cards) {
    const attrs = readBoardAttrs(card)
    if (!attrs) {
      unplaced.push(card)
      continue
    }
    let column = grouped.get(attrs.category)
    if (!column) {
      column = []
      grouped.set(attrs.category, column)
      categories.push(attrs.category)
    }
    column.push(card)
  }

  const cells = new Map<string, Map<number, BoardClue>>()
  // Board-wide, not per column. One fact may only be asked ONCE on a board:
  // "where did Luther meet Charles V" and "who did Luther meet at Worms" are
  // the same fact wearing two hats, and asking both is asking the same thing
  // twice. Enforced here rather than left to the author, because a fact asked
  // four ways is normal content, not a mistake.
  const claimedFacts = new Set<string>()
  let clueCount = 0
  let maxScore = 0

  for (const category of categories) {
    const pool = grouped.get(category) ?? []
    const order = new Map(pool.map((card, index) => [card.id, index]))
    const sorted = [...pool].sort(
      // Tie-break on the author's order, so two questions at the same rating
      // land the same way every render rather than depending on sort internals.
      (a, b) => rankBy(a) - rankBy(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    )

    // Deduped as we walk, not filtered once up front. Filtering against
    // `claimedFacts` alone would only block a fact ACROSS columns — two
    // variants of one fact inside the SAME column would both pass, because
    // neither is claimed at the moment the filter runs, and the board would
    // ask one fact twice in one row of tiles.
    const takenHere = new Set<string>()
    const eligible: PlayCard[] = []
    for (const card of sorted) {
      if (claimedFacts.has(card.factId) || takenHere.has(card.factId)) continue
      takenHere.add(card.factId)
      eligible.push(card)
    }

    const chosen = spread(eligible, TIERS.length)
    const chosenIds = new Set(chosen.map(card => card.id))

    const column = new Map<number, BoardClue>()
    chosen.forEach((card, index) => {
      const tier = TIERS[index]
      claimedFacts.add(card.factId)
      column.set(tier, { card, category, tier })
      clueCount += 1
      maxScore += pointsFor(tier)
    })
    cells.set(category, column)

    for (const card of sorted) {
      if (!chosenIds.has(card.id)) unplaced.push(card)
    }
  }

  return { categories, cells, clueCount, unplaced, maxScore }
}

/** Whether a set is worth offering "Play as board" for at all. */
export function isPlayable(cards: PlayCard[]): boolean {
  return cards.some(isClue)
}

/**
 * What a half-tagged set is still missing, phrased for a person.
 *
 * Returns null when nothing is missing. Shown in the editor so tagging a set
 * has visible progress rather than a silent threshold.
 */
export function missingForBoard(cards: PlayCard[]): string | null {
  const total = cards.length
  if (total === 0) return 'Add some facts first.'
  const tagged = cards.filter(isClue).length
  if (tagged === 0) {
    return 'Give facts a category to play this set as a board.'
  }
  if (tagged < total) {
    const rest = total - tagged
    return `${tagged} of ${total} questions are on the board. The other ${rest} ${rest === 1 ? 'is' : 'are'} drill-only until ${rest === 1 ? 'its fact gets' : 'their facts get'} a category.`
  }
  return null
}
