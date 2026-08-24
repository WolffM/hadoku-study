/**
 * The board, in miniature.
 *
 * Shown on the set page so choosing a mode is a look rather than a guess: a
 * full 5x5 grid and a half-empty one are different propositions, and the
 * numbers alone ("18 clues") do not say which you have. Holes read as holes.
 *
 * Lives with the game, not with the set page — that page renders whatever
 * `Preview` a game hands it and knows nothing about grids.
 */

import { useMemo } from 'react'
import type { StudySetDetail } from '../../api/types'
import { toPlayCards } from '../../model/playCards'
import { TIERS, buildBoard } from './model'

export function BoardPreview({ set }: { set: StudySetDetail }) {
  const board = useMemo(() => buildBoard(toPlayCards(set.facts)), [set.facts])

  // Decorative: the tile's own label already carries the clue count and score
  // for anyone not looking at pictures.
  return (
    <span
      className="board-preview"
      aria-hidden="true"
      style={{ '--preview-columns': board.categories.length } as React.CSSProperties}
    >
      {TIERS.map(tier =>
        board.categories.map(category => (
          <span
            key={`${category}-${tier}`}
            className={`board-preview__cell${
              board.cells.get(category)?.has(tier) ? ' board-preview__cell--filled' : ''
            }`}
          />
        ))
      )}
    </span>
  )
}
