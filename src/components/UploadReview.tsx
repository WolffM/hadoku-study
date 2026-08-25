/**
 * What an upload would do, before it does it.
 *
 * A PUT replaces a set's content wholesale, so on the wire "here is the new
 * version" is indistinguishable from "delete eleven facts". This is the screen
 * that makes them distinguishable to a person.
 *
 * Ordered by what it costs to get wrong, not by what changed most. Losing a
 * fact's rating history is silent and permanent; a reworded prompt is neither.
 * So the losses are stated first, in words, before the list of changes anyone
 * would scroll past.
 */

import { questionCount, type SetDiff } from '../model/diff'
import type { SetReport } from '../model/lint'

export interface UploadReviewProps {
  diff: SetDiff
  report: SetReport
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** The most human handle a fact has: whatever it says first. */
const nameOf = (slots: Record<string, string>): string => {
  const first = Object.values(slots).find(value => value.trim() !== '')
  return first ? first.slice(0, 72) : '(empty)'
}

export function UploadReview({ diff, report, saving, onConfirm, onCancel }: UploadReviewProps) {
  const errors = report.findings.filter(finding => finding.severity === 'error')
  const before = diff.counts.unchanged + diff.counts.changed + diff.counts.removed
  const after = diff.counts.unchanged + diff.counts.changed + diff.counts.added

  return (
    <section className="review" aria-label="Review this upload">
      <h2 className="review__title">Review this upload</h2>

      <p className="review__totals">
        <strong>{before}</strong> facts → <strong>{after}</strong>
        <span className="review__sep">·</span>
        <strong>{diff.questionsBefore}</strong> questions → <strong>{diff.questionsAfter}</strong>
      </p>

      {/* Stated first and in words. Both of these are permanent and neither is
          visible in the JSON. */}
      {diff.orphaned > 0 && (
        <p className="review__alarm">
          <b>
            {diff.orphaned} {diff.orphaned === 1 ? 'fact came' : 'facts came'} back without{' '}
            {diff.orphaned === 1 ? 'its' : 'their'} id
          </b>{' '}
          but {diff.orphaned === 1 ? 'matches' : 'match'} a fact already here. Saving this replaces{' '}
          {diff.orphaned === 1 ? 'it' : 'them'} with new {diff.orphaned === 1 ? 'a fact' : 'facts'}{' '}
          and discards every rating and answer {diff.orphaned === 1 ? 'it has' : 'they have'}{' '}
          earned. Ask for the file again with the ids kept.
        </p>
      )}

      {diff.counts.removed > diff.orphaned && (
        <p className="review__alarm">
          <b>{diff.counts.removed - diff.orphaned} facts would be deleted</b>, along with their
          ratings and answer history. There is no undo.
        </p>
      )}

      {errors.length > 0 && (
        <div className="review__block">
          <p className="review__head">{errors.length} questions will not work</p>
          <ul className="review__list">
            {errors.slice(0, 6).map((finding, at) => (
              <li key={at} className="review__item review__item--error">
                <b>Fact {finding.factIndex + 1}</b> {finding.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(diff.title || diff.description) && (
        <div className="review__block">
          <p className="review__head">Set details</p>
          <ul className="review__list">
            {diff.title && (
              <li className="review__item">
                Title: <b>{diff.title.before}</b> → <b>{diff.title.after}</b>
              </li>
            )}
            {diff.description && (
              <li className="review__item">
                Description: <b>{diff.description.before ?? '(none)'}</b> →{' '}
                <b>{diff.description.after ?? '(none)'}</b>
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="review__block">
        <p className="review__head">
          {diff.counts.unchanged > 0 && `${diff.counts.unchanged} unchanged`}
          {diff.counts.unchanged > 0 &&
            (diff.counts.changed || diff.counts.added || diff.counts.removed) &&
            ' · '}
          {diff.counts.changed > 0 && `${diff.counts.changed} edited`}
          {diff.counts.changed > 0 && (diff.counts.added || diff.counts.removed) && ' · '}
          {diff.counts.added > 0 && `${diff.counts.added} new`}
          {diff.counts.added > 0 && diff.counts.removed > 0 && ' · '}
          {diff.counts.removed > 0 && `${diff.counts.removed} removed`}
        </p>
        <ul className="review__list">
          {diff.facts
            // Unchanged facts are the majority and the least interesting thing
            // on the screen; the count above already says how many.
            .filter(change => change.kind !== 'unchanged')
            .map((change, at) => {
              if (change.kind === 'changed') {
                return (
                  <li key={at} className="review__item review__item--edit">
                    <span className="review__mark">edited</span>
                    <span className="review__name">{nameOf(change.after.slots)}</span>
                    <span className="review__note">{change.notes.join(' · ')}</span>
                  </li>
                )
              }
              if (change.kind === 'added') {
                return (
                  <li
                    key={at}
                    className={`review__item review__item--${change.orphanOf ? 'error' : 'add'}`}
                  >
                    <span className="review__mark">{change.orphanOf ? 'no id' : 'new'}</span>
                    <span className="review__name">{nameOf(change.after.slots)}</span>
                    <span className="review__note">
                      {change.orphanOf
                        ? 'matches a fact already here — its history would be lost'
                        : `${questionCount(change.after)} questions`}
                    </span>
                  </li>
                )
              }
              return (
                <li key={at} className="review__item review__item--remove">
                  <span className="review__mark">removed</span>
                  <span className="review__name">{nameOf(change.before.slots)}</span>
                  <span className="review__note">
                    {change.before.variants.length} questions, ratings lost
                  </span>
                </li>
              )
            })}
        </ul>
      </div>

      <p className="review__foot">
        Publication is not touched by an upload — a file describes content, not who may read it.
      </p>

      <div className="review__actions">
        <button
          type="button"
          className="btn btn--ghost btn--lg"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={onConfirm}
          disabled={saving || diff.empty}
        >
          {saving ? 'Saving…' : diff.empty ? 'Nothing to change' : 'Replace the set'}
        </button>
      </div>
    </section>
  )
}
