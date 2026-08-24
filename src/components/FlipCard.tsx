/**
 * One card, face down then face up, gradable by swipe.
 *
 * Three properties this component exists to guarantee:
 *
 * 1. **No layout shift on flip.** Both faces are stacked in the SAME grid cell,
 *    so the card is always as tall as its taller face — before you flip it, not
 *    after. Sizing to the visible face would make every flip jump the grade
 *    buttons out from under a thumb already moving toward them.
 * 2. **The flip is instant.** It is a GPU-composited `rotateY` on an element
 *    whose content is already in the DOM. Nothing is fetched, nothing mounts.
 * 3. **A swipe never fights the page.** `touch-action: pan-y` leaves vertical
 *    scrolling to the browser, and the horizontal gesture is only claimed once
 *    it has clearly out-run the vertical one.
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CardResult, StudyVariant } from '../api/types'

export interface FlipCardProps {
  front: string
  back: string
  /**
   * Slots shown alongside the question.
   *
   * Not decoration: a question that asks one slot and shows three is
   * unanswerable without them. Empty for a migrated flashcard, whose prompt
   * already IS the shown side — so nothing renders and the card looks exactly
   * as it always did.
   */
  context?: StudyVariant['given']
  flipped: boolean
  onFlip: () => void
  onGrade: (result: CardResult) => void
}

/** Movement under this is a tap, not a drag — thumbs are imprecise. */
const TAP_SLOP = 10
/** How far the gesture must commit to one axis before it is claimed. */
const AXIS_SLOP = 8

export function FlipCard({ front, back, context = [], flipped, onFlip, onGrade }: FlipCardProps) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)

  const origin = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'undecided' | 'x' | 'y'>('undecided')
  const moved = useRef(0)
  const elementRef = useRef<HTMLDivElement>(null)

  const threshold = useCallback(() => {
    const width = elementRef.current?.offsetWidth ?? 320
    return Math.min(110, Math.max(56, width * 0.26))
  }, [])

  const reset = useCallback(() => {
    origin.current = null
    axis.current = 'undecided'
    moved.current = 0
    setDx(0)
    setDragging(false)
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Grading is only meaningful once the answer is visible, so a face-down
      // card does not drag at all — it only taps to flip.
      if (!flipped) return
      origin.current = { x: e.clientX, y: e.clientY }
      axis.current = 'undecided'
      moved.current = 0
    },
    [flipped]
  )

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const from = origin.current
    if (!from) return

    const deltaX = e.clientX - from.x
    const deltaY = e.clientY - from.y
    moved.current = Math.max(moved.current, Math.hypot(deltaX, deltaY))

    if (axis.current === 'undecided') {
      if (Math.abs(deltaX) < AXIS_SLOP && Math.abs(deltaY) < AXIS_SLOP) return
      // Whichever axis moved further wins, once. Re-deciding mid-gesture is
      // what makes a card snatch the page out from under a scroll.
      axis.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
      if (axis.current === 'x') e.currentTarget.setPointerCapture(e.pointerId)
    }

    if (axis.current !== 'x') return
    setDragging(true)
    setDx(deltaX)
  }, [])

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const from = origin.current

      if (!flipped) {
        onFlip()
        reset()
        return
      }

      if (from && axis.current === 'x' && Math.abs(dx) >= threshold()) {
        onGrade(dx > 0 ? 'got' : 'missed')
        reset()
        return
      }

      if (from && moved.current < TAP_SLOP) onFlip()
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      reset()
    },
    [dx, flipped, onFlip, onGrade, reset, threshold]
  )

  // How far the gesture has committed, 0..1 — drives the tint so the card
  // shows its verdict before the thumb lifts.
  const commitment = Math.min(1, Math.abs(dx) / threshold())
  const verdict: CardResult | null =
    dragging && commitment > 0.15 ? (dx > 0 ? 'got' : 'missed') : null

  // No `onKeyDown` here on purpose: Drill owns the whole keyboard map (space to
  // flip, arrows to grade) on a window listener, and this element's key events
  // reach it by bubbling. A local handler would double-fire the flip.
  return (
    <div
      ref={elementRef}
      className="flip-card"
      data-flipped={flipped ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-verdict={verdict ?? 'none'}
      style={{
        transform: dragging ? `translateX(${dx}px) rotate(${dx * 0.02}deg)` : undefined,
        // Inline because it tracks a continuous gesture. A CSS custom property
        // set per-frame is the one case where a style attribute beats a class.
        ['--flip-card-commitment' as string]: commitment.toFixed(3)
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      role="button"
      tabIndex={0}
      aria-label={
        flipped
          ? `Answer: ${back}. Grade it.`
          : // The context is part of the question, so a screen reader has to
            // hear it before being asked to answer.
            `Question: ${context.map(g => `${g.slot}, ${g.value}`).join('. ')}${
              context.length > 0 ? '. ' : ''
            }${front}. Reveal the answer.`
      }
    >
      <div className="flip-card__inner">
        {/*
          Both faces render at all times and share one grid cell, so the card is
          always as tall as its taller face. The hidden one is hidden VISUALLY by
          `backface-visibility` — it is still laid out, which is the whole point
          — and hidden from screen readers by `aria-hidden`. Neither carries
          `display`/`visibility: hidden`, because either would collapse the
          height this arrangement exists to reserve.
        */}
        <div className="flip-card__face flip-card__face--front" aria-hidden={flipped}>
          {context.length > 0 && (
            <dl className="flip-card__given">
              {context.map(({ slot, value }) => (
                <div key={slot} className="flip-card__given-row">
                  <dt className="flip-card__given-slot">{slot}</dt>
                  <dd className="flip-card__given-value">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="flip-card__text">{front}</p>
        </div>
        <div className="flip-card__face flip-card__face--back" aria-hidden={!flipped}>
          <p className="flip-card__text">{back}</p>
        </div>
      </div>

      <span className="flip-card__hint" aria-hidden="true">
        {flipped ? 'Swipe right if you got it, left if you missed' : 'Tap to reveal'}
      </span>
    </div>
  )
}
