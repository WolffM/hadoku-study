/**
 * The board game.
 *
 * Built phone-first, for the same reason the drill loop was: this is the mode
 * people will actually play one-handed, on a couch, with a podcast paused.
 * Three things follow from that and are load-bearing rather than styling:
 *
 * - **A tile shows only its points.** That is what a real board does, and it is
 *   what lets 25 targets fit a 375px screen at a size a thumb can hit. The
 *   category names carry the meaning, once, along the top.
 * - **The clue opens as a full-screen sheet**, not an inline panel. An inline
 *   panel below a grid means the answer appears off-screen on a phone, and the
 *   reader has to scroll to find out whether they were right.
 * - **The actions are pinned to the bottom of the sheet.** Revealing the answer
 *   grows the content ABOVE them, so the buttons never move out from under a
 *   thumb already travelling toward them — the same rule the flip card follows.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameProps } from '../types'
import { TIERS, buildBoard, pointsFor, type BoardClue } from './model'

/** How a cell was resolved. Absent means unplayed. */
type Outcome = 'got' | 'missed'

export function Board({ set, onExit }: GameProps) {
  const board = useMemo(() => buildBoard(set.cards), [set.cards])
  // cardId -> clue, so scoring is a lookup rather than a scan of the deck for
  // every graded answer.
  const clues = useMemo(() => {
    const index = new Map<string, BoardClue>()
    for (const column of board.cells.values()) {
      for (const clue of column.values()) index.set(clue.card.id, clue)
    }
    return index
  }, [board])
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [open, setOpen] = useState<BoardClue | null>(null)
  const [revealed, setRevealed] = useState(false)

  const score = useMemo(
    () =>
      Object.entries(outcomes).reduce((total, [cardId, outcome]) => {
        if (outcome !== 'got') return total
        const clue = clues.get(cardId)
        return total + (clue ? pointsFor(clue.difficulty) : 0)
      }, 0),
    [clues, outcomes]
  )

  const playedCount = Object.keys(outcomes).length
  const finished = board.clueCount > 0 && playedCount === board.clueCount

  const openClue = useCallback((clue: BoardClue) => {
    setOpen(clue)
    setRevealed(false)
  }, [])

  const closeClue = useCallback(() => {
    setOpen(null)
    setRevealed(false)
  }, [])

  const grade = useCallback(
    (outcome: Outcome) => {
      if (!open) return
      setOutcomes(current => ({ ...current, [open.card.id]: outcome }))
      closeClue()
    },
    [closeClue, open]
  )

  // Escape closes the sheet, matching the drill's exit key. Bound while a clue
  // is open only, so it never competes with the board's own navigation.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeClue()
      }
      if (e.key === ' ' && !revealed) {
        e.preventDefault()
        setRevealed(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeClue, open, revealed])

  const restart = useCallback(() => {
    setOutcomes({})
    closeClue()
  }, [closeClue])

  if (board.clueCount === 0) {
    return (
      <div className="panel">
        <p>This set has no board clues yet — its cards need a category and a tier.</p>
        <button type="button" className="btn btn--ghost btn--lg" onClick={onExit}>
          Back to set
        </button>
      </div>
    )
  }

  return (
    <section className="board">
      <header className="board__bar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
          ← Leave
        </button>
        <p className="board__score">
          <span className="board__score-value">{score}</span>
          <span className="board__score-max"> / {board.maxScore}</span>
        </p>
      </header>

      <div
        className="board__grid"
        style={{ '--board-columns': board.categories.length } as React.CSSProperties}
      >
        {board.categories.map(category => (
          <h2 key={`head-${category}`} className="board__category">
            {category}
          </h2>
        ))}

        {TIERS.map(tier =>
          board.categories.map(category => {
            const clue = board.cells.get(category)?.get(tier)
            if (!clue) {
              return (
                <span
                  key={`${category}-${tier}`}
                  className="board__cell board__cell--empty"
                  aria-hidden="true"
                />
              )
            }
            const outcome = outcomes[clue.card.id]
            return (
              <button
                key={clue.card.id}
                type="button"
                className={`board__cell${outcome ? ` board__cell--${outcome}` : ''}`}
                onClick={() => openClue(clue)}
                disabled={outcome !== undefined}
                aria-label={`${category}, ${pointsFor(tier)} points${outcome ? `, answered ${outcome}` : ''}`}
              >
                {pointsFor(tier)}
              </button>
            )
          })
        )}
      </div>

      {finished && (
        <div className="board__done panel">
          <p>
            Board cleared — <strong>{score}</strong> of {board.maxScore}.
          </p>
          <button type="button" className="btn btn--primary btn--sm" onClick={restart}>
            Play again
          </button>
        </div>
      )}

      {board.unplaced.length > 0 && (
        <p className="muted board__note">
          {board.unplaced.length} {board.unplaced.length === 1 ? 'card is' : 'cards are'} not on the
          board. They are still in the deck when you study this set.
        </p>
      )}

      {open && (
        <div className="board__sheet" role="dialog" aria-modal="true" aria-label="Clue">
          <div className="board__sheet-head">
            <span className="board__sheet-cat">{open.category}</span>
            <span className="board__sheet-val">{pointsFor(open.difficulty)}</span>
          </div>

          <div className="board__sheet-body">
            <p className="board__clue">{open.card.front}</p>
            {revealed && (
              <div className="board__answer">
                <p className="board__answer-text">{open.card.back}</p>
                {open.card.detail && <p className="board__detail">{open.card.detail}</p>}
              </div>
            )}
          </div>

          <div className="board__sheet-actions">
            {revealed ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost btn--lg"
                  onClick={() => grade('missed')}
                >
                  Missed it
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  onClick={() => grade('got')}
                >
                  Got it
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--ghost btn--lg" onClick={closeClue}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  onClick={() => setRevealed(true)}
                >
                  Reveal answer
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
