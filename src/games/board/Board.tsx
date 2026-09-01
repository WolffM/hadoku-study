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
import { logger } from '@wolffm/logger/client'
import type { GameProps } from '../types'
import type { QuestionRating } from '../../api/types'
import { toPlayCards } from '../../model/playCards'
import { indexRatings, recordAttempt } from '../../state/attempts'
import { noteAnswer, type Movement } from '../../state/session'
import { SessionRecap } from '../../components/SessionRecap'
import { buildBoard, bySeedTier, pointsFor, type BoardClue, type RankBy } from './model'

/** How a cell was resolved. Absent means unplayed. */
type Outcome = 'got' | 'missed'

export function Board({ set, client, syncEnabled, onExit }: GameProps) {
  const cards = useMemo(() => toPlayCards(set.facts), [set.facts])

  /**
   * The ratings this board was DEALT from.
   *
   * Fetched once, held for the session, and deliberately never refreshed from
   * the answers recorded below. A board is a deal: re-ranking it as you play
   * would slide tiles out from under a thumb already moving toward one, and
   * the point of the rating is where it puts a question NEXT time.
   *
   * `null` means still loading; an empty map means there are none to have —
   * a signed-out reader, or a failed fetch — and the board falls back to the
   * author's seed order, which is exactly how it ranked before ratings existed.
   */
  const [ratings, setRatings] = useState<Map<string, QuestionRating> | null>(() =>
    syncEnabled ? null : new Map()
  )

  useEffect(() => {
    if (!syncEnabled) return
    let cancelled = false
    void client
      .getRatings(set.id)
      .then(fetched => {
        if (!cancelled) setRatings(indexRatings(fetched))
      })
      .catch(() => {
        // Offline, or the endpoint is unhappy. Seed order is a real board, so
        // there is nothing to tell the reader and nothing to stop.
        if (!cancelled) setRatings(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [client, set.id, syncEnabled])

  const board = useMemo(() => {
    if (ratings === null) return null
    // All-or-nothing per reader: the endpoint returns an entry for every
    // question in the set, so a board is never half-sorted by rating and half
    // by seed tier.
    const rankBy: RankBy =
      ratings.size > 0 ? card => ratings.get(card.id)?.local ?? card.seedTier : bySeedTier
    return buildBoard(cards, { rankBy })
  }, [cards, ratings])
  // question id -> clue, so scoring is a lookup rather than a scan for every
  // graded answer.
  const clues = useMemo(() => {
    const index = new Map<string, BoardClue>()
    for (const column of board?.columns ?? []) {
      for (const clue of column.cells.values()) index.set(clue.card.id, clue)
    }
    return index
  }, [board])
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  // What this sitting answered, for the recap. A board is played once through,
  // so the log and the outcomes map never disagree — but the log carries what
  // the ratings did, which the outcomes map has no room for.
  const [log, setLog] = useState<Movement[]>([])
  const [open, setOpen] = useState<BoardClue | null>(null)
  const [revealed, setRevealed] = useState(false)

  const score = useMemo(
    () =>
      Object.entries(outcomes).reduce((total, [cardId, outcome]) => {
        if (outcome !== 'got') return total
        const clue = clues.get(cardId)
        return total + (clue ? pointsFor(clue.tier) : 0)
      }, 0),
    [clues, outcomes]
  )

  // The deepest column decides how many rows the grid draws.
  const rowCount = Math.max(0, ...(board?.columns ?? []).map(column => column.cells.size))
  const playedCount = Object.keys(outcomes).length
  const finished = board !== null && board.clueCount > 0 && playedCount === board.clueCount

  // A completed board is the one thing here worth recording: it is the signal
  // that someone actually PLAYED rather than opened and left, and no HTTP log
  // can see it — the whole game runs client-side after the set is fetched.
  useEffect(() => {
    if (!finished || !board) return
    logger.event('study.board.completed', {
      setId: set.id,
      score,
      maxScore: board.maxScore,
      clues: board.clueCount
    })
  }, [board, finished, score, set.id])

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
      const answered = open.card
      // Never throws and queues on failure, so a bookkeeping problem can never
      // interrupt a game in progress. The recap is built from whatever comes
      // back — including nothing, which is the signed-out and offline case.
      void recordAttempt(
        { client, setId: set.id, game: 'board', enabled: syncEnabled },
        { factId: answered.factId, variantKey: answered.variantKey, result: outcome }
      ).then(changes => setLog(current => noteAnswer(current, answered, outcome, changes)))
      closeClue()
    },
    [client, closeClue, open, set.id, syncEnabled]
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
    setLog([])
    closeClue()
  }, [closeClue])

  if (board === null) {
    // Brief, and only on entry. The set is already in memory; this is one
    // request, and waiting for it is what guarantees the grid is dealt before
    // it is drawn rather than re-sorting a moment later.
    return (
      <div className="panel">
        <p className="muted">Dealing the board…</p>
      </div>
    )
  }

  if (board.clueCount === 0) {
    return (
      <div className="panel">
        <p>This set has no board clues yet — its facts need a category.</p>
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

      {/* The bar stays at the top; everything in here is the play area, and it
          centres in whatever height is left over. Without the wrapper the grid
          sat against the header with the rest of a desktop screen empty below
          it. */}
      <div className="board__stage">
        <div
          className="board__grid"
          style={{ '--board-columns': board.columns.length } as React.CSSProperties}
        >
          {board.columns.map(column => (
            <h2 key={`head-${column.slot}`} className="board__category">
              {column.label}
            </h2>
          ))}

          {/* Rows are as deep as the deepest column. A shallower one leaves its
              expensive rows empty, which reads as "less in this category"
              rather than as a missing tile. */}
          {Array.from({ length: rowCount }, (_unused, index) => index + 1).map(tier =>
            board.columns.map(column => {
              const clue = column.cells.get(tier)
              if (!clue) {
                return (
                  <span
                    key={`${column.slot}-${tier}`}
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
                  aria-label={`${column.label}, ${pointsFor(tier)} points${outcome ? `, answered ${outcome}` : ''}`}
                >
                  {pointsFor(tier)}
                </button>
              )
            })
          )}
        </div>

        {finished && (
          <div className="board__done panel">
            <SessionRecap
              headline="Board cleared"
              detail={
                <>
                  <strong>{score}</strong> of {board.maxScore}
                </>
              }
              log={log}
            >
              <button type="button" className="btn btn--primary btn--sm" onClick={restart}>
                Play again
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
                Back to set
              </button>
            </SessionRecap>
          </div>
        )}
      </div>

      {open && (
        <div className="board__sheet" role="dialog" aria-modal="true" aria-label="Clue">
          <div className="board__sheet-head">
            <span className="board__sheet-cat">{open.category}</span>
            <span className="board__sheet-val">{pointsFor(open.tier)}</span>
          </div>

          <div className="board__sheet-body">
            {/*
              Context first, and only when there is any. A question that asks
              one slot and shows three is unanswerable without them — and a
              migrated flashcard has none, because its prompt already IS the
              shown side.
            */}
            {open.card.given.length > 0 && (
              <dl className="board__given">
                {open.card.given.map(({ slot, value }) => (
                  <div key={slot} className="board__given-row">
                    <dt className="board__given-slot">{slot}</dt>
                    <dd className="board__given-value">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
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
