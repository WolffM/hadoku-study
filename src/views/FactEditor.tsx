/**
 * Editing a fact that a front and a back cannot hold.
 *
 * Two text inputs can express a flashcard and nothing else. A fact with four
 * slots asked three ways has authoring in it that has to be visible to be
 * edited — and until this existed, the editor's honest option was to show
 * those facts read-only and pass them through untouched.
 *
 * Controlled throughout: the row's `FactInput` is the single source of truth
 * and every control here hands back a whole new one. Local state would be a
 * second copy of the fact, and the two would disagree the moment an import
 * replaced the rows underneath.
 */

import { useCallback } from 'react'
import type { FactInput, QuestionInput } from '../api/types'
import { KNOWN_SLOTS, defaultQuestions } from '../model/slots'
import { readCategory, removeSlot, renameSlot, withCategory } from '../model/factEdits'
import { TIERS, pointsFor } from '../games/board'

export interface FactEditorProps {
  fact: FactInput
  onChange: (fact: FactInput) => void
  /** Numbered for screen readers, so every control says which fact it belongs
   *  to rather than the twelfth "Prompt" on the page. */
  index: number
}

export function FactEditor({ fact, onChange, index }: FactEditorProps) {
  const slots = fact.slots
  const names = Object.keys(slots)
  const questions = fact.questions ?? null

  const patch = useCallback(
    (over: Partial<FactInput>) => onChange({ ...fact, ...over }),
    [fact, onChange]
  )

  const patchQuestion = useCallback(
    (at: number, over: Partial<QuestionInput>) => {
      if (!questions) return
      patch({ questions: questions.map((q, i) => (i === at ? { ...q, ...over } : q)) })
    },
    [patch, questions]
  )

  const setSlotName = useCallback(
    (from: string, to: string) => onChange(renameSlot(fact, from, to)),
    [fact, onChange]
  )

  const dropSlot = useCallback((name: string) => onChange(removeSlot(fact, name)), [fact, onChange])

  const addSlot = useCallback(() => {
    // The first known slot not already used, so the common case is one click
    // rather than one click and some typing.
    const suggestion = KNOWN_SLOTS.find(name => !(name in slots)) ?? `slot${names.length + 1}`
    patch({ slots: { ...slots, [suggestion]: '' } })
  }, [names.length, patch, slots])

  const setCategory = useCallback(
    (category: string) => onChange(withCategory(fact, category)),
    [fact, onChange]
  )

  return (
    <div className="fact">
      <div className="fact__group">
        <p className="fact__legend">What is true</p>
        {names.length === 0 && <p className="muted fact__note">No slots yet.</p>}
        {names.map(name => (
          <div key={name} className="fact__slot">
            <input
              className="field__input fact__slot-name"
              defaultValue={name}
              onBlur={e => setSlotName(name, e.target.value)}
              list="editor-slot-names"
              maxLength={40}
              aria-label={`Fact ${index + 1}, slot name`}
            />
            <input
              className="field__input"
              value={slots[name]}
              onChange={e => patch({ slots: { ...slots, [name]: e.target.value } })}
              placeholder="Value"
              maxLength={2000}
              aria-label={`Fact ${index + 1}, ${name}`}
            />
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => dropSlot(name)}
              aria-label={`Remove slot ${name} from fact ${index + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm" onClick={addSlot}>
          Add a slot
        </button>
      </div>

      <div className="fact__group">
        <p className="fact__legend">What to ask</p>
        {questions === null ? (
          <>
            {/* Undeclared is a real, sensible state — not an empty one — so it
                says what it will do rather than looking unfinished. */}
            <p className="muted fact__note">
              Asks each slot in turn, showing the others: {names.length}{' '}
              {names.length === 1 ? 'question' : 'questions'}.
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => patch({ questions: defaultQuestions(names) })}
              disabled={names.length < 2}
            >
              Write them out
            </button>
          </>
        ) : (
          <>
            {questions.map((question, at) => (
              <div key={at} className="fact__question">
                <div className="fact__question-head">
                  <label className="fact__inline">
                    <span className="fact__inline-label">Answer is</span>
                    <select
                      className="field__input"
                      value={question.ask}
                      onChange={e => patchQuestion(at, { ask: e.target.value })}
                      aria-label={`Fact ${index + 1}, question ${at + 1}, answered slot`}
                    >
                      {names.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fact__inline">
                    <span className="fact__inline-label">Starts at</span>
                    <select
                      className="field__input"
                      value={question.seedTier ?? ''}
                      onChange={e =>
                        patchQuestion(at, {
                          seedTier: e.target.value === '' ? undefined : Number(e.target.value)
                        })
                      }
                      aria-label={`Fact ${index + 1}, question ${at + 1}, starting tier`}
                    >
                      <option value="">Middle</option>
                      {TIERS.map(tier => (
                        <option key={tier} value={tier}>
                          {pointsFor(tier)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon"
                    onClick={() => patch({ questions: questions.filter((_, i) => i !== at) })}
                    aria-label={`Remove question ${at + 1} from fact ${index + 1}`}
                  >
                    ×
                  </button>
                </div>

                <input
                  className="field__input"
                  value={question.prompt ?? ''}
                  onChange={e => patchQuestion(at, { prompt: e.target.value || undefined })}
                  placeholder={
                    KNOWN_SLOTS.includes(question.ask as (typeof KNOWN_SLOTS)[number])
                      ? 'How it reads (optional, but the fallback is plain)'
                      : 'How it reads — needed for a slot name we cannot phrase'
                  }
                  maxLength={2000}
                  aria-label={`Fact ${index + 1}, question ${at + 1}, prompt`}
                />

                <div className="fact__shows">
                  <span className="fact__inline-label">Shows</span>
                  {names
                    .filter(name => name !== question.ask)
                    .map(name => {
                      // Undeclared `given` means every other slot, so an
                      // unchecked box has to write an explicit list rather than
                      // leaving it undefined and meaning the opposite.
                      const shown = question.given ?? names.filter(n => n !== question.ask)
                      const checked = shown.includes(name)
                      return (
                        <label key={name} className="fact__show">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              patchQuestion(at, {
                                given: checked
                                  ? shown.filter(n => n !== name)
                                  : [...shown, name].sort(
                                      (a, b) => names.indexOf(a) - names.indexOf(b)
                                    )
                              })
                            }
                          />
                          <span>{name}</span>
                        </label>
                      )
                    })}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => patch({ questions: [...questions, { ask: names[0] ?? 'answer' }] })}
              disabled={names.length === 0}
            >
              Add a question
            </button>
          </>
        )}
      </div>

      <div className="fact__group">
        <input
          className="field__input"
          value={fact.detail ?? ''}
          onChange={e => patch({ detail: e.target.value || null })}
          placeholder="Detail shown after the answer (optional)"
          maxLength={2000}
          aria-label={`Fact ${index + 1} detail`}
        />
        <input
          className="field__input"
          list="editor-categories"
          value={readCategory(fact)}
          onChange={e => setCategory(e.target.value)}
          placeholder="Board category (optional)"
          maxLength={40}
          aria-label={`Fact ${index + 1} board category`}
        />
      </div>
    </div>
  )
}
