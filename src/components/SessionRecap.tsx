/**
 * What just happened, and what to come back to.
 *
 * Shared by every mode, because the useful thing to say at the end of a
 * sitting does not depend on how you played it: here is how it went, here are
 * the ones you missed, and here is what your answers did to them.
 *
 * This is the ONLY place a reader is shown a rating. Everywhere else the
 * rating is invisible machinery that decides what you get asked — surfacing it
 * on a tile or beside a question would turn a quiz into a dashboard. At the
 * end of a sitting it is news, so it is worth saying once.
 */

import type { ReactNode } from 'react'
import { recap, type Movement } from '../state/session'

export interface SessionRecapProps {
  headline: string
  /** The count line, phrased by whichever mode this was. */
  detail: ReactNode
  log: Movement[]
  /** The mode's own actions — play again, leave. Passed in rather than
   *  configured, because two buttons with different labels and order in every
   *  mode is not a prop, it is a slot. */
  children: ReactNode
}

/** How a rating moved, for someone who has never seen one before. Up means
 *  the question got harder for you, which is the opposite of intuition about
 *  a number going up, so the words carry it rather than the sign. */
function movementLabel(delta: number): string | null {
  if (delta > 0) return 'harder for you now'
  if (delta < 0) return 'easier now'
  return null
}

export function SessionRecap({ headline, detail, log, children }: SessionRecapProps) {
  const summary = recap(log)

  return (
    <section className="recap">
      <h2 className="recap__title">{headline}</h2>
      <p className="recap__line">{detail}</p>

      {summary.review.length > 0 && (
        <div className="recap__review">
          <p className="recap__review-head">Worth another look</p>
          <ul className="recap__list">
            {summary.review.map(movement => {
              const label = summary.rated ? movementLabel(movement.localDelta) : null
              return (
                <li key={movement.card.id} className="recap__item">
                  <span className="recap__item-front">{movement.card.front}</span>
                  <span className="recap__item-answer">{movement.card.back}</span>
                  {label !== null && <span className="recap__item-move">{label}</span>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="recap__actions">{children}</div>
    </section>
  )
}
