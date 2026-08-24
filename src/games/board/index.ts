/**
 * The board game's registry entry.
 *
 * Everything this mode is lives under this directory: how it decides a set is
 * playable, how it deals a grid, and how it renders. The set page and the
 * router know none of it.
 *
 * It reads NO attrs. Columns are derived from the slots a set's questions ask,
 * so a set becomes playable as a board by having real content rather than by
 * being tagged for this game — which is why the `board` namespace that used to
 * hold a per-fact category is gone entirely.
 */

import type { GameDefinition } from '../types'
import { toPlayCards } from '../../model/playCards'
import { Board } from './Board'
import { BoardPreview } from './BoardPreview'
import { buildBoard, missingForBoard } from './model'

export const boardGame: GameDefinition = {
  id: 'board',
  label: 'Play as board',
  blurb: 'Four categories dealt from your set. Pick a tier, then score yourself on the reveal.',
  Preview: BoardPreview,
  availability: set => {
    const cards = toPlayCards(set.facts)
    const board = buildBoard(cards)
    if (board.clueCount === 0) {
      return { playable: false, blocked: missingForBoard(cards) ?? undefined }
    }
    const columns = board.columns.length
    return {
      playable: true,
      summary: `${columns} ${columns === 1 ? 'category' : 'categories'} · ${board.clueCount} clues · ${board.maxScore} points`
    }
  },
  Component: Board
}

export {
  bySeedTier,
  buildBoard,
  candidateCategories,
  chooseCategories,
  isPlayable,
  labelFor,
  missingForBoard,
  pointsFor,
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  TIERS
} from './model'
