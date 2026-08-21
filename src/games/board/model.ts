/**
 * A set, read as a board.
 *
 * Board-ness is DERIVED, never stored. A set whose cards carry a category and
 * a tier can be played as a board; one whose cards do not is a plain deck.
 * There is no `mode` flag to drift out of step with the cards it describes,
 * and no migration to run when an author finishes tagging a deck — the same
 * rows simply start qualifying.
 *
 * The asymmetry is deliberate and runs one way: every board is already a deck,
 * because a clue is a card with a front and a back. A deck becomes a board only
 * once someone has done the authoring.
 */

import type { StudyCard, StudySetDetail } from '../../api/types'

/** Board rows. Matches MAX_DIFFICULTY in the worker. */
export const TIERS = [1, 2, 3, 4, 5] as const

/**
 * A tier's score.
 *
 * Points are computed here rather than stored, so a board can be rescaled
 * without rewriting a single clue.
 */
export const pointsFor = (difficulty: number): number => difficulty * 100

/** This game's namespace in a card's `attrs` bag. Matches the definition's id. */
export const BOARD_NAMESPACE = 'board'

export interface BoardAttrs {
  category: string
  difficulty: number
}

/** A card carrying usable board attributes. */
export interface BoardClue {
  card: StudyCard
  category: string
  difficulty: number
}

/**
 * Read this game's attributes off a card.
 *
 * Defensive about shape because the bag passes unknown namespaces through
 * unvalidated — a `board` key written by an older or hand-edited file may be
 * anything at all, and a card whose attrs do not parse is simply not a clue.
 */
export function readBoardAttrs(card: StudyCard): BoardAttrs | null {
  const raw = card.attrs?.[BOARD_NAMESPACE]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { category, difficulty } = raw as Record<string, unknown>
  if (typeof category !== 'string' || category.trim() === '') return null
  if (typeof difficulty !== 'number' || !Number.isInteger(difficulty)) return null
  if (difficulty < 1 || difficulty > TIERS.length) return null
  return { category: category.trim(), difficulty }
}

export function toBoardClue(card: StudyCard): BoardClue | null {
  const attrs = readBoardAttrs(card)
  return attrs ? { card, ...attrs } : null
}

export interface BoardModel {
  /** Column labels, in first-appearance order — which is the author's order,
   *  since cards arrive sorted by position. */
  categories: string[]
  /** category -> tier -> the clue, where one exists. A board with holes is a
   *  normal in-progress state, not an error. */
  cells: Map<string, Map<number, BoardClue>>
  clueCount: number
  /** Cards that carry no board metadata. They stay drillable and simply do not
   *  appear on the grid. */
  unplaced: StudyCard[]
  maxScore: number
}

export function buildBoard(cards: StudyCard[]): BoardModel {
  const categories: string[] = []
  const cells = new Map<string, Map<number, BoardClue>>()
  const unplaced: StudyCard[] = []
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
    // last one would make the board depend on card order in a way nobody can
    // see. The loser stays in the deck.
    if (column.has(clue.difficulty)) {
      unplaced.push(card)
      continue
    }
    column.set(clue.difficulty, clue)
    clueCount += 1
    maxScore += pointsFor(clue.difficulty)
  }

  return { categories, cells, clueCount, unplaced, maxScore }
}

/** Whether a set is worth offering "Play as board" for at all. */
export function isPlayable(set: StudySetDetail): boolean {
  return set.cards.some(card => readBoardAttrs(card) !== null)
}

/**
 * What a half-tagged set is still missing, phrased for a person.
 *
 * Returns null when nothing is missing. Shown in the editor so tagging a deck
 * has visible progress rather than a silent threshold.
 */
export function missingForBoard(cards: StudyCard[]): string | null {
  const total = cards.length
  if (total === 0) return 'Add some cards first.'
  const tagged = cards.filter(card => readBoardAttrs(card) !== null).length
  if (tagged === 0) {
    return 'Give cards a category and a tier to play this set as a board.'
  }
  if (tagged < total) {
    const rest = total - tagged
    return `${tagged} of ${total} cards are on the board. The other ${rest} ${rest === 1 ? 'is' : 'are'} drill-only until ${rest === 1 ? 'it gets' : 'they get'} a category and a tier.`
  }
  return null
}
