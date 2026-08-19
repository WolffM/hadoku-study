/**
 * Making and editing a set.
 *
 * Cards are edited locally and saved WHOLESALE — the API replaces the whole
 * deck in one transaction. A set is a few kB of text the editor already holds,
 * so a per-card save protocol would buy nothing but a reorder/insert/delete
 * dance and the drift that comes with it.
 */

import { useCallback, useRef, useState } from 'react'
import type { StudyClient } from '../api/client'
import type { CardInput, StudySetDetail } from '../api/types'
import { SetFileError, parseImport } from '../setFile'

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
  const [imported, setImported] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchRow = useCallback((key: string, field: 'front' | 'back', value: string) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, [field]: value } : row)))
  }, [])

  const removeRow = useCallback((key: string) => {
    setRows(current => (current.length === 1 ? [newRow()] : current.filter(row => row.key !== key)))
  }, [])

  /**
   * Take cards from anywhere — a set file, a raw API response, a spreadsheet
   * column — and land them in the editor.
   *
   * Cards APPEND rather than replace, because the destructive reading of an
   * import cannot be undone from here, and someone adding a second batch to a
   * deck they have been typing is the likelier intent. Title and description
   * only fill fields that are still EMPTY, so importing into a set that is
   * already named never renames it behind the editor's back.
   */
  const applyImport = useCallback((text: string, source: string) => {
    let parsed
    try {
      parsed = parseImport(text)
    } catch (err: unknown) {
      setError(
        err instanceof SetFileError ? err.message : 'Could not read that as a set or a card list.'
      )
      return
    }

    setRows(current => {
      // Drop the blank starter rows so an import into a fresh set does not
      // leave three empty cards above it.
      const kept = current.filter(row => row.front.trim() !== '' || row.back.trim() !== '')
      return [...kept, ...parsed.cards.map(card => newRow(card.front, card.back))]
    })

    if (parsed.title !== undefined)
      setTitle(current => (current.trim() === '' ? parsed.title! : current))
    if (typeof parsed.description === 'string') {
      setDescription(current => (current.trim() === '' ? parsed.description! : current))
    }

    setError(null)
    setImported(
      `Added ${parsed.cards.length} ${parsed.cards.length === 1 ? 'card' : 'cards'} from ${source}.`
    )
    setBulk('')
    setShowBulk(false)
  }, [])

  const applyBulk = useCallback(() => {
    if (bulk.trim() !== '') applyImport(bulk, 'the pasted text')
  }, [applyImport, bulk])

  const applyFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      file
        .text()
        .then(text => applyImport(text, file.name))
        .catch(() => setError('Could not read that file.'))
      // Clear the input so choosing the SAME file twice fires a change event
      // the second time — otherwise a failed import cannot be retried without
      // picking a different file first.
      if (fileInput.current) fileInput.current.value = ''
    },
    [applyImport]
  )

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

    // One request either way. Saving an existing set used to be a PATCH, then
    // a card PUT, then a re-GET — three round trips on a phone, and a window
    // in which the title had changed but the deck had not.
    const work = existing
      ? client.replaceSet(existing.id, {
          title: cleanTitle,
          description: cleanDescription,
          cards
        })
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
        <div className="editor__import-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => fileInput.current?.click()}
          >
            Import a file
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowBulk(v => !v)}
          >
            {showBulk ? 'Close paste' : 'Paste a list'}
          </button>
        </div>
      </div>

      {/* `hidden`, not clipped: the "Import a file" button above IS the
          accessible control, so leaving this input in the tab order and the
          accessibility tree would offer a second, unlabelled "Choose File"
          alongside it. Browsers still honour a programmatic click on it. */}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".json,.txt,.tsv,.csv,application/json,text/plain,text/tab-separated-values,text/csv"
        onChange={e => applyFile(e.target.files?.[0])}
      />

      {showBulk && (
        <div className="editor__bulk">
          <label className="field">
            <span className="field__label">
              Paste an exported set, or one card per line — front, then a tab or comma, then back
            </span>
            <textarea
              className="field__input field__input--area"
              rows={6}
              value={bulk}
              onChange={e => setBulk(e.target.value)}
              placeholder={'кот\tcat\nсобака\tdog'}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={applyBulk}
            disabled={bulk.trim() === ''}
          >
            Add cards
          </button>
        </div>
      )}

      {imported !== null && <p className="muted editor__imported">{imported}</p>}

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
