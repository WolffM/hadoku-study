/**
 * The board game's registry entry.
 *
 * Everything this mode is lives under this directory: how it reads its
 * attributes off a fact, how it decides a set is playable, and how it renders.
 * The set page and the router know none of it.
 */

import type { GameDefinition } from '../types'
import { toPlayCards } from '../../model/playCards'
import { Board } from './Board'
import { BoardPreview } from './BoardPreview'
import { BOARD_NAMESPACE, buildBoard, missingForBoard } from './model'

export const boardGame: GameDefinition = {
  id: BOARD_NAMESPACE,
  label: 'Play as board',
  blurb: 'Pick a category and a tier, then score yourself on the reveal.',
  Preview: BoardPreview,
  availability: set => {
    const cards = toPlayCards(set.facts)
    const board = buildBoard(cards)
    if (board.clueCount === 0) {
      return { playable: false, blocked: missingForBoard(cards) ?? undefined }
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
