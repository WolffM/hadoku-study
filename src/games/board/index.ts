/**
 * The board game's registry entry.
 *
 * Everything this mode is lives under this directory: how it reads its
 * attributes off a card, how it decides a set is playable, and how it renders.
 * The set page and the router know none of it.
 */

import type { GameDefinition } from '../types'
import { Board } from './Board'
import { BOARD_NAMESPACE, buildBoard, missingForBoard } from './model'

export const boardGame: GameDefinition = {
  id: BOARD_NAMESPACE,
  label: 'Play as board',
  availability: set => {
    const board = buildBoard(set.cards)
    if (board.clueCount === 0) {
      return { playable: false, blocked: missingForBoard(set.cards) ?? undefined }
    }
    return {
      playable: true,
      summary: `${board.clueCount} ${board.clueCount === 1 ? 'clue' : 'clues'} · ${board.maxScore} points`
    }
  },
  Component: Board
}

export {
  BOARD_NAMESPACE,
  buildBoard,
  missingForBoard,
  pointsFor,
  readBoardAttrs,
  TIERS
} from './model'
