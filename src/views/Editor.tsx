/**
 * Making and editing a set.
 *
 * Content is edited locally and saved WHOLESALE — the API replaces the whole
 * set in one transaction. A set is a few kB of text the editor already holds,
 * so a per-fact save protocol would buy nothing but a reorder/insert/delete
 * dance and the drift that comes with it.
 *
 * Two kinds of row, and the distinction is load-bearing rather than cosmetic.
 * A SIMPLE fact is the two-slot flashcard this UI was built for, and it edits
 * inline exactly as it always did. A RICH fact — four slots asked three ways —
 * cannot be represented by two text inputs, so it is shown read-only and
 * passed through byte for byte. Flattening one into a front and a back would
 * destroy authoring the editor simply has no controls for, and it would do it
 * silently, on save, to the sets that had the most work in them.
 *
 * Editing rich facts properly is Phase 3. Until then the file is the editor
 * for them, which is a real answer rather than a stopgap: the export IS the
 * import, so "edit it as a file" is one download and one paste.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { StudyClient } from '../api/client'
import type { FactInput, StudySetDetail } from '../api/types'
import { LEGACY_ANSWER_SLOT, LEGACY_PROMPT_SLOT, SetFileError, parseImport } from '../setFile'
import type { PlayCard } from '../model/playCards'
import { BOARD_NAMESPACE, TIERS, missingForBoard, pointsFor } from '../games/board'

export interface EditorProps {
  client: StudyClient
  /** null when creating a set that does not exist yet. */
  existing: StudySetDetail | null
  onSaved: (set: StudySetDetail) => void
  onCancel: () => void
}

/**
 * Whether a fact is the plain flashcard the inline inputs can hold.
 *
 * Exactly two slots, named the way the v1 backfill named them, asked one way.
 * Anything else — an extra slot, a second question, an unfamiliar `ask` — has
 * authoring in it that two text boxes cannot express.
 */
function isSimple(fact: FactInput): boolean {
  const names = Object.keys(fact.slots)
  if (names.length !== 2) return false
  if (!names.includes(LEGACY_PROMPT_SLOT) || !names.includes(LEGACY_ANSWER_SLOT)) return false
  const questions = fact.questions
  if (!questions || questions.length === 0) return true
  return questions.length === 1 && questions[0].ask === LEGACY_ANSWER_SLOT
}

interface SimpleRow {
  kind: 'simple'
  key: string
  /** Carried so a save keeps this fact's rating history. Absent on a new one. */
  id?: string
  /** Narrowed from the API's optional/nullable shape to what a controlled
   *  input needs: empty string and null are the editor's "not set". */
  front: string
  back: string
  detail: string
  category: string
  /** The single question's `seedTier`. A tier seeds a RATING, so it lives on
   *  the question rather than in the board's namespace. */
  tier: number | null
  /** Other games' namespaces, passed through untouched. The editor does not
   *  know what they are and must not drop them. */
  otherAttrs: Record<string, unknown>
}

interface RichRow {
  kind: 'rich'
  key: string
  /** Verbatim. Nothing in this file may reshape it. */
  fact: FactInput
}

type Row = SimpleRow | RichRow

let rowSeq = 0

const readBoardCategory = (fact: FactInput): string => {
  const raw = fact.attrs?.[BOARD_NAMESPACE]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ''
  const { category } = raw as Record<string, unknown>
  return typeof category === 'string' ? category : ''
}

function toRow(fact: FactInput): Row {
  const key = `row-${rowSeq++}`
  if (!isSimple(fact)) return { kind: 'rich', key, fact }
  return {
    kind: 'simple',
    key,
    id: fact.id,
    front: fact.slots[LEGACY_PROMPT_SLOT] ?? '',
    back: fact.slots[LEGACY_ANSWER_SLOT] ?? '',
    detail: fact.detail ?? '',
    category: readBoardCategory(fact),
    tier: fact.questions?.[0]?.seedTier ?? null,
    otherAttrs: Object.fromEntries(
      Object.entries(fact.attrs ?? {}).filter(([name]) => name !== BOARD_NAMESPACE)
    )
  }
}

const blankRow = (): SimpleRow => ({
  kind: 'simple',
  key: `row-${rowSeq++}`,
  front: '',
  back: '',
  detail: '',
  category: '',
  tier: null,
  otherAttrs: {}
})

/** A simple row, back in the shape the API takes. */
function toFact(row: SimpleRow): FactInput {
  const fact: FactInput = {
    slots: { [LEGACY_PROMPT_SLOT]: row.front.trim(), [LEGACY_ANSWER_SLOT]: row.back.trim() },
    // ALWAYS declared, never left to the default expansion — which would also
    // generate the reverse question and quietly double the set.
    questions: [
      {
        ask: LEGACY_ANSWER_SLOT,
        given: [LEGACY_PROMPT_SLOT],
        ...(row.tier === null ? {} : { seedTier: row.tier })
      }
    ]
  }
  // Sent back so the server keeps the row, and with it every rating and
  // attempt hanging off this fact.
  if (row.id !== undefined) fact.id = row.id

  const detail = row.detail.trim()
  if (detail !== '') fact.detail = detail

  // Only send what was actually set. An empty string is the editor's "not
  // set", and posting it would store a blank category that then renders as a
  // nameless board column.
  const category = row.category.trim()
  const attrs: Record<string, unknown> = { ...row.otherAttrs }
  if (category !== '') attrs[BOARD_NAMESPACE] = { category }
  if (Object.keys(attrs).length > 0) fact.attrs = attrs

  return fact
}

/** Enough of a question for `missingForBoard` to judge it, without a save. */
const previewCard = (row: SimpleRow): PlayCard => ({
  id: row.key,
  factId: row.key,
  variantKey: 'preview',
  front: row.front,
  back: row.back,
  detail: null,
  given: [],
  open: false,
  seedTier: row.tier ?? 0,
  attrs: row.category.trim() === '' ? {} : { [BOARD_NAMESPACE]: { category: row.category.trim() } }
})

const isBlank = (row: Row): boolean =>
  row.kind === 'simple' && row.front.trim() === '' && row.back.trim() === ''

export function Editor({ client, existing, onSaved, onCancel }: EditorProps) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [rows, setRows] = useState<Row[]>(() =>
    existing && existing.facts.length > 0
      ? existing.facts.map(toRow)
      : [blankRow(), blankRow(), blankRow()]
  )
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [imported, setImported] = useState<string | null>(null)
  // Board fields stay hidden until asked for. Most sets are plain decks, and
  // extra inputs per row would tax every one of them to serve some. Opens by
  // default when the set already has board data, so editing a board does not
  // hide the thing that makes it a board.
  const [showBoard, setShowBoard] = useState(
    () => existing?.facts.some(fact => readBoardCategory(fact) !== '') ?? false
  )
  const fileInput = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const simpleRows = useMemo(
    () => rows.filter((row): row is SimpleRow => row.kind === 'simple'),
    [rows]
  )
  const richCount = rows.length - simpleRows.length

  // What still stands between this set and a playable board. Null when nothing
  // does — tagging a set should show progress, not a silent threshold.
  const boardProgress = useMemo(
    () => missingForBoard(simpleRows.filter(row => row.front.trim() !== '').map(previewCard)),
    [simpleRows]
  )

  const patchRow = useCallback(
    (key: string, field: 'front' | 'back' | 'category' | 'detail', value: string) => {
      setRows(current =>
        current.map(row =>
          row.key === key && row.kind === 'simple' ? { ...row, [field]: value } : row
        )
      )
    },
    []
  )

  const patchTier = useCallback((key: string, tier: number | null) => {
    setRows(current =>
      current.map(row => (row.key === key && row.kind === 'simple' ? { ...row, tier } : row))
    )
  }, [])

  const removeRow = useCallback((key: string) => {
    setRows(current => {
      const next = current.filter(row => row.key !== key)
      return next.length === 0 ? [blankRow()] : next
    })
  }, [])

  /**
   * Take content from anywhere — a set file, a raw API response, a spreadsheet
   * column, a v1 export from before facts existed — and land it in the editor.
   *
   * Facts APPEND rather than replace, because the destructive reading of an
   * import cannot be undone from here, and someone adding a second batch to a
   * set they have been typing is the likelier intent. Title and description
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
      // leave three empty facts above it.
      const kept = current.filter(row => !isBlank(row))
      return [...kept, ...parsed.facts.map(toRow)]
    })

    if (parsed.title !== undefined)
      setTitle(current => (current.trim() === '' ? parsed.title! : current))
    if (typeof parsed.description === 'string') {
      setDescription(current => (current.trim() === '' ? parsed.description! : current))
    }

    // An imported board must not look like it lost its metadata.
    if (parsed.facts.some(fact => readBoardCategory(fact) !== '')) setShowBoard(true)

    setError(null)
    setImported(
      `Added ${parsed.facts.length} ${parsed.facts.length === 1 ? 'fact' : 'facts'} from ${source}.`
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

    // A half-filled row is a mistake, not a fact. Dropping them silently would
    // lose work, so say what happened instead.
    const filled = rows.filter(row => !isBlank(row))
    const incomplete = filled.filter(
      row => row.kind === 'simple' && (row.front.trim() === '' || row.back.trim() === '')
    )
    if (incomplete.length > 0) {
      setError(
        `${incomplete.length} ${incomplete.length === 1 ? 'fact is' : 'facts are'} missing a side.`
      )
      return
    }

    const facts: FactInput[] = filled.map(row => (row.kind === 'simple' ? toFact(row) : row.fact))
    const cleanDescription = description.trim() === '' ? null : description.trim()

    setSaving(true)
    setError(null)

    // One request either way. Saving an existing set used to be a PATCH, then
    // a content PUT, then a re-GET — three round trips on a phone, and a
    // window in which the title had changed but the content had not.
    const work = existing
      ? client.replaceSet(existing.id, {
          title: cleanTitle,
          description: cleanDescription,
          facts
        })
      : client.createSet({ title: cleanTitle, description: cleanDescription, facts })

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
            placeholder="The Reformation"
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
          Facts <span className="muted">({filledCount(rows)})</span>
        </h2>
        <div className="editor__import-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowBoard(v => !v)}
            aria-pressed={showBoard}
          >
            {showBoard ? 'Hide board fields' : 'Board fields'}
          </button>
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
            Add facts
          </button>
        </div>
      )}

      {imported !== null && <p className="muted editor__imported">{imported}</p>}

      {richCount > 0 && (
        <p className="muted editor__imported">
          {richCount} {richCount === 1 ? 'fact has' : 'facts have'} more than a front and a back, so
          {richCount === 1 ? ' it is' : ' they are'} shown here read-only and saved untouched.
          Export the set to edit {richCount === 1 ? 'it' : 'them'}.
        </p>
      )}

      {showBoard && (
        <>
          {/* Suggests categories already in use, so a board does not end up with
              "Places" and "places" as two columns. */}
          <datalist id="editor-categories">
            {[...new Set(simpleRows.map(row => row.category.trim()).filter(c => c !== ''))].map(
              category => (
                <option key={category} value={category} />
              )
            )}
          </datalist>
          {boardProgress !== null && <p className="muted editor__imported">{boardProgress}</p>}
        </>
      )}

      <ul className="editor__rows">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className={`editor__row${row.kind === 'rich' ? ' editor__row--rich' : ''}`}
          >
            <span className="editor__row-num" aria-hidden="true">
              {index + 1}
            </span>

            {row.kind === 'rich' ? (
              <div className="editor__rich">
                <p className="editor__rich-slots">
                  {Object.entries(row.fact.slots).map(([slot, value]) => (
                    <span key={slot} className="editor__rich-slot">
                      <b>{slot}</b> {value}
                    </span>
                  ))}
                </p>
                <p className="muted editor__rich-note">
                  {row.fact.questions?.length ?? Object.keys(row.fact.slots).length} questions ·
                  read-only here
                </p>
              </div>
            ) : (
              <>
                <input
                  className="field__input"
                  value={row.front}
                  onChange={e => patchRow(row.key, 'front', e.target.value)}
                  placeholder="Front"
                  aria-label={`Fact ${index + 1} front`}
                />
                <input
                  className="field__input"
                  value={row.back}
                  onChange={e => patchRow(row.key, 'back', e.target.value)}
                  placeholder="Back"
                  aria-label={`Fact ${index + 1} back`}
                />
              </>
            )}

            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => removeRow(row.key)}
              aria-label={`Remove fact ${index + 1}`}
            >
              ×
            </button>

            {showBoard && row.kind === 'simple' && (
              <div className="editor__board-fields">
                <input
                  className="field__input"
                  list="editor-categories"
                  value={row.category}
                  onChange={e => patchRow(row.key, 'category', e.target.value)}
                  placeholder="Category"
                  maxLength={40}
                  aria-label={`Fact ${index + 1} board category`}
                />
                <select
                  className="field__input"
                  value={row.tier ?? ''}
                  onChange={e =>
                    patchTier(row.key, e.target.value === '' ? null : Number(e.target.value))
                  }
                  aria-label={`Fact ${index + 1} starting tier`}
                >
                  <option value="">No tier</option>
                  {TIERS.map(tier => (
                    <option key={tier} value={tier}>
                      {pointsFor(tier)}
                    </option>
                  ))}
                </select>
                <input
                  className="field__input"
                  value={row.detail}
                  onChange={e => patchRow(row.key, 'detail', e.target.value)}
                  placeholder="Detail shown after the answer (optional)"
                  maxLength={2000}
                  aria-label={`Fact ${index + 1} detail`}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setRows(current => [...current, blankRow()])}
      >
        Add a fact
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

const filledCount = (rows: Row[]): number => rows.filter(row => !isBlank(row)).length
