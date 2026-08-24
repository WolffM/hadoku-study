/**
 * The drill loop.
 *
 * The whole set arrived with the set fetch, so nothing here touches the network
 * between cards — a flip is a state change over data already in memory. The
 * only requests this view makes are the bookmark ones, and those are debounced
 * out of the way.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudyClient } from '../api/client'
import type { CardResult, StudySetDetail } from '../api/types'
import { toPlayCards } from '../model/playCards'
import { recordAttempt } from '../state/attempts'
import { FlipCard } from '../components/FlipCard'
import {
  clearLocal,
  fromServer,
  grade,
  isComplete,
  loadLocal,
  newer,
  reconcile,
  startDrill,
  summarize,
  type DrillState
} from '../state/drill'
import { useProgressSync } from '../state/useProgressSync'

export interface DrillProps {
  set: StudySetDetail
  client: StudyClient
  /** Whether the server can hold this reader's bookmark. Signed-out readers
   *  keep theirs on the device and nowhere else. */
  syncEnabled: boolean
  shuffle: boolean
  onExit: () => void
}

export function Drill({ set, client, syncEnabled, shuffle, onExit }: DrillProps) {
  // Every question the set holds, not every fact. A fact asked four ways is
  // four things to get right, and a pass that walked facts would ask about
  // Worms once and call it known.
  const cards = useMemo(() => toPlayCards(set.facts), [set.facts])
  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards])

  // Restored SYNCHRONOUSLY from the device so a resumed session paints in place
  // — a lock screen should cost nothing, and a spinner over a bookmark we
  // already hold would be a spinner for its own sake.
  const restored = useRef<DrillState | null>(null)
  const [state, setState] = useState<DrillState>(() => {
    const local = loadLocal(set.id)
    const usable = local ? reconcile(local, cards) : null
    restored.current = usable
    return usable ?? startDrill(set.id, cards, shuffle)
  })

  const [flipped, setFlipped] = useState(false)
  const [cleared, setCleared] = useState(false)
  const touched = useRef(false)

  const complete = isComplete(state)
  const summary = summarize(state, cards.length)

  // Derived here, above the grade handler, rather than after the early returns
  // it used to sit below. Recording an answer needs to know WHICH question was
  // answered, and the alternative — reaching into the setState updater for the
  // queue head — would fire the request twice under StrictMode's double
  // invocation and record every answer in development twice over.
  const currentCard = state.queue[0] ? (cardsById.get(state.queue[0]) ?? null) : null

  useProgressSync(client, complete ? null : state, syncEnabled)

  // ------------------------------------------------------------------------
  // Adopt the server bookmark, if it is the better one
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (!syncEnabled) return
    let cancelled = false

    void client
      .getProgress(set.id)
      .then(progress => {
        if (cancelled || !progress) return
        // Never yank the pass out from under someone who has already started
        // grading in this sitting.
        if (touched.current) return

        const remote = reconcile(fromServer(set.id, progress), cards)
        if (!remote) return

        setState(current =>
          // A freshly started pass carries `Date.now()`, so it would always
          // out-rank a real bookmark on timestamp alone. When nothing was
          // restored locally there is no local pass to defend, and the server's
          // is simply the one to use.
          restored.current === null ? remote : (newer(current, remote) ?? current)
        )
      })
      .catch(() => {
        // Offline, or the bookmark endpoint is unhappy. The device copy is
        // already driving the pass; there is nothing to tell the user.
      })

    return () => {
      cancelled = true
    }
  }, [cards, client, set.id, syncEnabled])

  // ------------------------------------------------------------------------
  // A finished pass owns no bookmark
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (!complete || cleared) return
    setCleared(true)
    clearLocal(set.id)
    if (syncEnabled) void client.clearProgress(set.id).catch(() => undefined)
  }, [cleared, client, complete, set.id, syncEnabled])

  const applyGrade = useCallback(
    (result: CardResult) => {
      touched.current = true
      setFlipped(false)
      if (currentCard) {
        // Fire and forget: `recordAttempt` never throws and queues on failure,
        // so a bookkeeping problem can never interrupt a pass.
        void recordAttempt(
          { client, setId: set.id, game: 'drill', enabled: syncEnabled },
          {
            factId: currentCard.factId,
            variantKey: currentCard.variantKey,
            result
          }
        )
      }
      setState(current => grade(current, result))
    },
    [client, currentCard, set.id, syncEnabled]
  )

  const restart = useCallback(() => {
    touched.current = true
    setCleared(false)
    setFlipped(false)
    setState(startDrill(set.id, cards, shuffle))
  }, [cards, set.id, shuffle])

  // ------------------------------------------------------------------------
  // Keyboard: space flips, arrows grade
  // ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let the focused control have its own keys. Without this, space on the
      // "Leave" button would both press it and flip the card behind it.
      const target = e.target as HTMLElement | null
      if (target && target !== document.body && target.closest('button, input, textarea, select')) {
        return
      }

      if (e.key === 'Escape') {
        onExit()
        return
      }
      if (complete) return

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped(f => !f)
      } else if (flipped && e.key === 'ArrowRight') {
        e.preventDefault()
        applyGrade('got')
      } else if (flipped && e.key === 'ArrowLeft') {
        e.preventDefault()
        applyGrade('missed')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyGrade, complete, flipped, onExit])

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------

  if (complete) {
    return (
      <section className="drill drill--done">
        <h2 className="drill__done-title">Pass complete</h2>
        <p className="drill__done-line">
          <strong>{summary.got}</strong> of <strong>{summary.total}</strong> on the first try
        </p>
        {summary.missed > 0 && (
          <p className="drill__done-sub">
            {summary.missed} came round again before you had {summary.missed === 1 ? 'it' : 'them'}.
          </p>
        )}
        <div className="drill__done-actions">
          <button type="button" className="btn btn--primary btn--lg" onClick={restart}>
            Study again
          </button>
          <button type="button" className="btn btn--ghost btn--lg" onClick={onExit}>
            Back to set
          </button>
        </div>
      </section>
    )
  }

  if (!currentCard) {
    // reconcile() guarantees every queued id exists, so this is unreachable in
    // practice — but rendering nothing beats rendering a blank card, and it
    // keeps the type honest without a non-null assertion.
    return (
      <section className="drill">
        <p className="drill__empty">This set has no questions to study yet.</p>
        <button type="button" className="btn btn--ghost btn--lg" onClick={onExit}>
          Back to set
        </button>
      </section>
    )
  }

  const done = summary.total - summary.remaining

  return (
    <section className="drill" aria-label={`Studying ${set.title}`}>
      <header className="drill__bar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
          Leave
        </button>
        <div
          className="drill__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={done}
          aria-label="Questions done"
        >
          <div
            className="drill__progress-fill"
            style={{ width: `${summary.total === 0 ? 0 : (done / summary.total) * 100}%` }}
          />
        </div>
        <span className="drill__count">
          {done}/{summary.total}
        </span>
      </header>

      <div className="drill__stage">
        <FlipCard
          key={`${currentCard.id}-${done}`}
          front={currentCard.front}
          back={currentCard.back}
          context={currentCard.given}
          flipped={flipped}
          onFlip={() => setFlipped(f => !f)}
          onGrade={applyGrade}
        />
      </div>

      {/*
        Pinned to the bottom and sized for a thumb. The pair is always rendered
        so the stage never resizes when the answer appears — they are DISABLED
        before the flip, not absent.
      */}
      <div className="drill__grade" aria-hidden={!flipped}>
        <button
          type="button"
          className="btn btn--danger btn--grade"
          disabled={!flipped}
          onClick={() => applyGrade('missed')}
        >
          Missed it
        </button>
        <button
          type="button"
          className="btn btn--success btn--grade"
          disabled={!flipped}
          onClick={() => applyGrade('got')}
        >
          Got it
        </button>
      </div>
    </section>
  )
}
