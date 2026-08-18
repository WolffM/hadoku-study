/**
 * Making and editing a set.
 *
 * Cards are edited locally and saved WHOLESALE — the API replaces the whole
 * deck in one transaction. A set is a few kB of text the editor already holds,
 * so a per-card save protocol would buy nothing but a reorder/insert/delete
 * dance and the drift that comes with it.
 */

import { useCallback, useState } from 'react'
import type { StudyClient } from '../api/client'
import type { CardInput, StudySetDetail } from '../api/types'

export interface EditorProps {
  client: StudyClient
  /** null when creating a set that does not exist yet. */
  existing: StudySetDetail | null
  onSaved: (set: StudySetDetail) => void
  onCancel: () => void
}

interface Row extends CardInput {
  /** Stable across reorders and edits, so React never reuses one row's DOM for
   *  another's text — which is what makes an input lose its caret mid-word. */
  key: string
}

let rowSeq = 0
const newRow = (front = '', back = ''): Row => ({ key: `row-${rowSeq++}`, front, back })

/**
 * Split pasted text into cards.
 *
 * Tab first, because that is what a spreadsheet, a Google Sheet and Anki all
 * produce on copy — the realistic way anyone arrives with 200 cards already
 * written. A comma fallback covers hand-typed lines; anything after the first
 * separator stays with the back, so "cat, the animal" survives intact.
 */
function parseBulk(text: string): CardInput[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const at = line.includes('\t') ? line.indexOf('\t') : line.indexOf(',')
      if (at === -1) return { front: line, back: '' }
      return { front: line.slice(0, at).trim(), back: line.slice(at + 1).trim() }
    })
    .filter(card => card.front !== '')
}

export function Editor({ client, existing, onSaved, onCancel }: EditorProps) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [rows, setRows] = useState<Row[]>(() =>
    existing && existing.cards.length > 0
      ? existing.cards.map(card => newRow(card.front, card.back))
      : [newRow(), newRow(), newRow()]
  )
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchRow = useCallback((key: string, field: 'front' | 'back', value: string) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, [field]: value } : row)))
  }, [])

  const removeRow = useCallback((key: string) => {
    setRows(current => (current.length === 1 ? [newRow()] : current.filter(row => row.key !== key)))
  }, [])

  const applyBulk = useCallback(() => {
    const parsed = parseBulk(bulk)
    if (parsed.length === 0) return
    setRows(current => {
      // Drop the blank starter rows so a paste into a fresh set does not leave
      // three empty cards above it.
      const kept = current.filter(row => row.front.trim() !== '' || row.back.trim() !== '')
      return [...kept, ...parsed.map(card => newRow(card.front, card.back))]
    })
    setBulk('')
    setShowBulk(false)
  }, [bulk])

  const save = useCallback(() => {
    const cleanTitle = title.trim()
    if (cleanTitle === '') {
      setError('Give the set a title.')
      return
    }

    // A half-filled row is a mistake, not a card. Dropping them silently would
    // lose work, so say what happened instead.
    const filled = rows.filter(row => row.front.trim() !== '' || row.back.trim() !== '')
    const incomplete = filled.filter(row => row.front.trim() === '' || row.back.trim() === '')
    if (incomplete.length > 0) {
      setError(
        `${incomplete.length} ${incomplete.length === 1 ? 'card is' : 'cards are'} missing a side.`
      )
      return
    }

    const cards: CardInput[] = filled.map(row => ({
      front: row.front.trim(),
      back: row.back.trim()
    }))
    const cleanDescription = description.trim() === '' ? null : description.trim()

    setSaving(true)
    setError(null)

    const work = existing
      ? client
          .updateSet(existing.id, { title: cleanTitle, description: cleanDescription })
          .then(() => client.replaceCards(existing.id, cards))
          .then(() => client.getSet(existing.id))
      : client.createSet({ title: cleanTitle, description: cleanDescription, cards })

    work.then(onSaved).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not save the set')
      setSaving(false)
    })
  }, [client, description, existing, onSaved, rows, title])

  return (
    <section className="editor">
      <div className="editor__fields">
        <label className="field">
          <span className="field__label">Title</span>
          <input
            className="field__input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Russian — animals"
            maxLength={120}
          />
        </label>

        <label className="field">
          <span className="field__label">Description</span>
          <input
            className="field__input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional"
            maxLength={500}
          />
        </label>
      </div>

      <div className="editor__cards-head">
        <h2 className="editor__heading">
          Cards <span className="muted">({rows.filter(r => r.front.trim() !== '').length})</span>
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setShowBulk(v => !v)}
        >
          {showBulk ? 'Close paste' : 'Paste a list'}
        </button>
      </div>

      {showBulk && (
        <div className="editor__bulk">
          <label className="field">
            <span className="field__label">
              One card per line — front, then a tab or comma, then back
            </span>
            <textarea
              className="field__input field__input--area"
              rows={6}
              value={bulk}
              onChange={e => setBulk(e.target.value)}
              placeholder={'кот\tcat\nсобака\tdog'}
            />
          </label>
          <button type="button" className="btn btn--primary btn--sm" onClick={applyBulk}>
            Add {parseBulk(bulk).length || ''} cards
          </button>
        </div>
      )}

      <ul className="editor__rows">
        {rows.map((row, index) => (
          <li key={row.key} className="editor__row">
            <span className="editor__row-num" aria-hidden="true">
              {index + 1}
            </span>
            <input
              className="field__input"
              value={row.front}
              onChange={e => patchRow(row.key, 'front', e.target.value)}
              placeholder="Front"
              aria-label={`Card ${index + 1} front`}
            />
            <input
              className="field__input"
              value={row.back}
              onChange={e => patchRow(row.key, 'back', e.target.value)}
              placeholder="Back"
              aria-label={`Card ${index + 1} back`}
            />
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => removeRow(row.key)}
              aria-label={`Remove card ${index + 1}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setRows(current => [...current, newRow()])}
      >
        Add a card
      </button>

      {error !== null && (
        <p className="panel panel--error" role="alert">
          {error}
        </p>
      )}

      <div className="editor__actions">
        <button
          type="button"
          className="btn btn--ghost btn--lg"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button type="button" className="btn btn--primary btn--lg" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Create set'}
        </button>
      </div>
    </section>
  )
}
