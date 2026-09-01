/**
 * Dealing a board.
 *
 * The constraint that makes this more than a sort: **one fact may be asked
 * only once per board**. Columns are asked SLOTS now, so one fact's questions
 * scatter across several of them — "where did Luther meet Charles V" and "who
 * did Luther meet at Worms" are the same fact wearing two hats, and a board
 * that asked both would be asking the same thing twice.
 *
 * That turns filling the grid into an assignment problem rather than a series
 * of independent picks: a fact taken by one column is unavailable to every
 * other, so a greedy pass can strand a column that had few options left. The
 * classic fix is backtracking; this uses **maximum bipartite matching**
 * instead, which is shorter, always finds a full board when one exists, and
 * has no retry budget to tune.
 *
 * Cells state a PREFERENCE — the question they would ideally hold, spread
 * across the column's difficulty range — and the matching honours it where it
 * can and falls back where the fact is already spoken for.
 */

import type { PlayCard } from '../../model/playCards'
import type { Category } from './categories'
import type { RankBy } from './model'

/** Columns and rows a full board wants. Four columns, not five: five headings
 *  do not read on a phone, and four leaves room for a wider label. */
export const DEFAULT_COLUMNS = 4
export const DEFAULT_ROWS = 5

/**
 * Indices spanning a list, so a column ladders instead of showing its five
 * easiest.
 *
 * Duplicated positions are possible on short lists (six candidates into five
 * rows), so the caller treats these as a PREFERENCE rather than a partition —
 * matching resolves the collisions.
 */
function spreadIndices(count: number, rows: number): number[] {
  if (count <= 1) return Array.from({ length: rows }, () => 0)
  return Array.from({ length: rows }, (_, row) =>
    Math.round((row * (count - 1)) / Math.max(1, rows - 1))
  )
}

interface Cell {
  column: number
  /** Fact ids this cell would take, best first. */
  prefers: string[]
}

/**
 * One fact per column, best-ranked question wins.
 *
 * A fact asked the same slot twice would otherwise compete with itself for two
 * rows of one column, which is the same fact twice on the board by another
 * route.
 */
function bestPerFact(cards: PlayCard[], rankBy: RankBy): PlayCard[] {
  const best = new Map<string, PlayCard>()
  for (const card of cards) {
    const held = best.get(card.factId)
    if (!held || rankBy(card) < rankBy(held)) best.set(card.factId, card)
  }
  return [...best.values()].sort((a, b) => rankBy(a) - rankBy(b) || a.id.localeCompare(b.id))
}

/**
 * Kuhn's algorithm: try to give this cell a fact, displacing others if they
 * have somewhere else to go.
 *
 * The whole reason a greedy pass is not enough. When a cell wants a fact
 * another cell already holds, this asks that other cell to move rather than
 * giving up — which is what finds the full board in the cases where columns
 * genuinely compete for the same few facts.
 */
function assign(
  cell: number,
  cells: Cell[],
  takenBy: Map<string, number>,
  visited: Set<string>
): boolean {
  for (const factId of cells[cell].prefers) {
    if (visited.has(factId)) continue
    visited.add(factId)
    const holder = takenBy.get(factId)
    if (holder === undefined || assign(holder, cells, takenBy, visited)) {
      takenBy.set(factId, cell)
      return true
    }
  }
  return false
}

export interface Placement {
  /** Index into the categories array. */
  column: number
  card: PlayCard
}

/**
 * Choose which question fills each cell.
 *
 * Returns placements only; the caller decides which ROW each one lands in, by
 * rank, so difficulty ordering stays one concern and fact allocation stays
 * another.
 */
export function dealCells(categories: Category[], rows: number, rankBy: RankBy): Placement[] {
  // Per column, the questions it could use — one per fact, easiest first.
  const pools = categories.map(category => bestPerFact(category.cards, rankBy))
  // Keyed by COLUMN and fact, and the column key must be the same thing the
  // lookup below uses. It was the asked slot on both sides while a column was
  // a slot; it is the archetype on both sides now, and a mismatch here would
  // silently place nothing.
  const byFact = new Map<string, PlayCard>()
  for (const pool of pools)
    for (const card of pool) byFact.set(`${card.archetype ?? ''}:${card.factId}`, card)

  const cells: Cell[] = []
  categories.forEach((_category, column) => {
    const pool = pools[column]
    const wanted = Math.min(rows, pool.length)
    const preferred = spreadIndices(pool.length, wanted)
    for (let row = 0; row < wanted; row += 1) {
      const target = preferred[row]
      // Everything this cell could take, nearest its ideal difficulty first —
      // so a contested cell slides to a neighbouring question rather than to
      // whatever happens to be free.
      const prefers = pool
        .map((card, index) => ({ card, distance: Math.abs(index - target) }))
        .sort((a, b) => a.distance - b.distance)
        .map(entry => entry.card.factId)
      cells.push({ column, prefers })
    }
  })

  const takenBy = new Map<string, number>()
  for (let cell = 0; cell < cells.length; cell += 1) {
    assign(cell, cells, takenBy, new Set())
  }

  const placements: Placement[] = []
  for (const [factId, cell] of takenBy) {
    const column = cells[cell].column
    const card = byFact.get(`${categories[column].key}:${factId}`)
    if (card) placements.push({ column, card })
  }
  return placements
}
