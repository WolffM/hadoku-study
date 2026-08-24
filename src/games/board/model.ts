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
 * in the fact's attrs, because a column label is genuinely board-specific. The
 * ROW comes from the question's `seedTier`, which is not — a tier seeds a
 * rating, and ratings belong to every mode. That split is why `difficulty`
 * left this namespace in migration 0003.
 */

import type { PlayCard } from '../../model/playCards'

/** Board rows. Matches MAX_SEED_TIER in the worker. */
export const TIERS = [1, 2, 3, 4, 5] as const

/**
 * A tier's score.
 *
 * Points are computed here rather than stored, so a board can be rescaled
 * without rewriting a single clue.
 */
export const pointsFor = (tier: number): number => tier * 100

/** This game's namespace in a fact's `attrs` bag. Matches the definition's id. */
export const BOARD_NAMESPACE = 'board'

export interface BoardAttrs {
  category: string
}

/** A question that can sit on the grid. */
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

export function toBoardClue(card: PlayCard): BoardClue | null {
  const attrs = readBoardAttrs(card)
  if (!attrs) return null
  if (!Number.isInteger(card.seedTier) || card.seedTier < 1 || card.seedTier > TIERS.length) {
    return null
  }
  return { card, category: attrs.category, tier: card.seedTier }
}

export interface BoardModel {
  /** Column labels, in first-appearance order — which is the author's order,
   *  since questions arrive in fact position order. */
  categories: string[]
  /** category -> tier -> the clue, where one exists. A board with holes is a
   *  normal in-progress state, not an error. */
  cells: Map<string, Map<number, BoardClue>>
  clueCount: number
  /** Questions carrying no board metadata. They stay drillable and simply do
   *  not appear on the grid. */
  unplaced: PlayCard[]
  maxScore: number
}

export function buildBoard(cards: PlayCard[]): BoardModel {
  const categories: string[] = []
  const cells = new Map<string, Map<number, BoardClue>>()
  const unplaced: PlayCard[] = []
  let clueCount = 0
  let maxScore = 0

  for (const card of cards) {
    const clue = toBoardClue(card)
    if (!clue) {
      unplaced.push(card)
      continue
    }
    let column = cells.get(clue.category)
    if (!column) {
      column = new Map<number, BoardClue>()
      cells.set(clue.category, column)
      categories.push(clue.category)
    }
    // First clue wins a contested cell. Two clues at the same category and tier
    // is an authoring mistake with no right answer, and silently showing the
    // last one would make the board depend on question order in a way nobody
    // can see. The loser stays in the deck.
    //
    // This gets common in v2 and stays correct: a fact asked four ways puts
    // four questions in one category at one tier, and exactly one of them
    // belongs on the grid. Phase 4's generator replaces this with a real
    // choice; until then, first-wins is the honest placeholder.
    if (column.has(clue.tier)) {
      unplaced.push(card)
      continue
    }
    column.set(clue.tier, clue)
    clueCount += 1
    maxScore += pointsFor(clue.tier)
  }

  return { categories, cells, clueCount, unplaced, maxScore }
}

/** Whether a set is worth offering "Play as board" for at all. */
export function isPlayable(cards: PlayCard[]): boolean {
  return cards.some(card => toBoardClue(card) !== null)
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
  const tagged = cards.filter(card => toBoardClue(card) !== null).length
  if (tagged === 0) {
    return 'Give facts a category to play this set as a board.'
  }
  if (tagged < total) {
    const rest = total - tagged
    return `${tagged} of ${total} questions are on the board. The other ${rest} ${rest === 1 ? 'is' : 'are'} drill-only until ${rest === 1 ? 'its fact gets' : 'their facts get'} a category.`
  }
  return null
}
