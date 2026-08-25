/**
 * Making and editing a set.
 *
 * Content is edited locally and saved WHOLESALE — the API replaces the whole
 * set in one transaction. A set is a few kB of text the editor already holds,
 * so a per-fact save protocol would buy nothing but a reorder/insert/delete
 * dance and the drift that comes with it.
 *
 * ONE row model, two renderers. A row always holds a whole `FactInput`; what
 * changes is how it is drawn. A two-slot flashcard gets the pair of text
 * inputs this UI was built for, because a deck of two hundred of them would be
 * miserable any other way. Anything richer — or anything the author expands —
 * gets the full editor, where slots and questions are visible because that is
 * the only way they can be edited.
 *
 * The split is presentation, never storage. An earlier version kept two row
 * SHAPES and passed rich facts through untouched, which was safe but meant the
 * editor could show you a fact it could not let you change.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { StudyClient } from '../api/client'
import type { FactInput, StudySetDetail } from '../api/types'
import { LEGACY_ANSWER_SLOT, LEGACY_PROMPT_SLOT, SetFileError, parseImport } from '../setFile'
import { KNOWN_SLOTS } from '../model/slots'
import { boardAdvice, lintSet } from '../model/lint'
import {
  blankFact,
  cleaned,
  factIssue,
  isBlank as isFactBlank,
  isSimple,
  simpleTier,
  withTier
} from '../model/factEdits'
import { TIERS, pointsFor } from '../games/board'
import { FactEditor } from './FactEditor'

export interface EditorProps {
  client: StudyClient
  /** null when creating a set that does not exist yet. */
  existing: StudySetDetail | null
  onSaved: (set: StudySetDetail) => void
  onCancel: () => void
}

/**
 * One editable fact.
 *
 * `fact` is the whole truth; `expanded` is only how it is drawn. A row that
 * cannot be drawn simply — four slots, several questions — is always expanded
 * regardless of the flag, so the flag can never hide something it cannot show.
 */
interface Row {
  /** Stable across reorders and edits, so React never reuses one row's DOM for
   *  another's text — which is what makes an input lose its caret mid-word. */
  key: string
  fact: FactInput
  expanded: boolean
}

let rowSeq = 0

const toRow = (fact: FactInput): Row => ({
  key: `row-${rowSeq++}`,
  fact,
  expanded: false
})

const blankRow = (): Row => toRow(blankFact())

/** Dropped silently on import and on save — everything else with content in
 *  it is kept and reported on. */
const isBlank = (row: Row): boolean => isFactBlank(row.fact)

/** How many findings to show. A bad import can produce dozens, and a wall of
 *  them is read as noise rather than as a list of things to fix. */
const MAX_FINDINGS = 8

export function Editor({ client, existing, onSaved, onCancel }: EditorProps) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [rows, setRows] = useState<Row[]>(() =>
    existing && existing.facts.length > 0
      ? existing.facts.map(fact =>
          toRow({
            id: fact.id,
            slots: fact.slots,
            questions: fact.questions ?? undefined,
            detail: fact.detail ?? null,
            attrs: fact.attrs ?? null
          })
        )
      : [blankRow(), blankRow(), blankRow()]
  )
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [imported, setImported] = useState<string | null>(null)
  // Board fields stay hidden until asked for. Most sets are plain decks, and
  // extra inputs per row would tax every one of them to serve some. Opens by
  // default when the set already has board data, so editing a board does not
  // hide the thing that makes it a board.
  // Opens by default for a set that has been given real slots, since that is
  // the set whose author is likely tuning tiers rather than typing cards.
  const [showExtras, setShowExtras] = useState(
    () => existing?.facts.some(fact => Object.keys(fact.slots).length > 2) ?? false
  )
  const fileInput = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchFact = useCallback((key: string, fact: FactInput) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, fact } : row)))
  }, [])

  const toggleExpanded = useCallback((key: string) => {
    setRows(current =>
      current.map(row => (row.key === key ? { ...row, expanded: !row.expanded } : row))
    )
  }, [])

  const removeRow = useCallback((key: string) => {
    setRows(current => {
      const next = current.filter(row => row.key !== key)
      return next.length === 0 ? [blankRow()] : next
    })
  }, [])

  /**
   * What is wrong with the content, as opposed to what is wrong with the file.
   *
   * The API rejects a malformed set. It cannot reject a well-formed one that
   * is simply bad — a question whose prompt contains its own answer parses,
   * imports and plays. This runs on whatever an agent hands back, so a bad
   * batch is visible before it is saved rather than after it is played.
   */
  const report = useMemo(
    () => lintSet(rows.filter(row => !isBlank(row)).map(row => row.fact)),
    [rows]
  )
  const advice = useMemo(() => boardAdvice(report), [report])

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

    // An imported set with real slots must not look like it lost them.
    if (parsed.facts.some(fact => Object.keys(fact.slots).length > 2)) setShowExtras(true)

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
    const kept = rows.filter(row => !isBlank(row)).map(row => cleaned(row.fact))
    const broken = kept.filter(fact => factIssue(fact) !== null)
    if (broken.length > 0) {
      setError(
        `${broken.length} ${broken.length === 1 ? 'fact' : 'facts'} ${factIssue(broken[0])}.`
      )
      return
    }

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
          facts: kept
        })
      : client.createSet({ title: cleanTitle, description: cleanDescription, facts: kept })

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
          Facts <span className="muted">({rows.filter(row => !isBlank(row)).length})</span>
        </h2>
        <div className="editor__import-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowExtras(v => !v)}
            aria-pressed={showExtras}
          >
            {showExtras ? 'Hide tier & detail' : 'Tier & detail'}
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

      {/* Suggests slot names already known, so a set does not end up with
          `when` and `year` as two slots meaning the same thing. */}
      <datalist id="editor-slot-names">
        {KNOWN_SLOTS.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {report.findings.length > 0 && (
        <div className="lint">
          <p className="lint__head">
            {report.findings.filter(f => f.severity === 'error').length > 0
              ? 'Worth fixing before you save'
              : 'Worth a look'}
          </p>
          <ul className="lint__list">
            {report.findings.slice(0, MAX_FINDINGS).map((finding, at) => (
              <li key={at} className={`lint__item lint__item--${finding.severity}`}>
                <b>Fact {finding.factIndex + 1}</b> {finding.message}
              </li>
            ))}
          </ul>
          {report.findings.length > MAX_FINDINGS && (
            <p className="lint__more">…and {report.findings.length - MAX_FINDINGS} more.</p>
          )}
        </div>
      )}

      {advice !== null && <p className="muted editor__imported">{advice}</p>}

      <ul className="editor__rows">
        {rows.map((row, index) => {
          // A fact two inputs cannot hold is always expanded, whatever the flag
          // says — the flag can never hide something it cannot show.
          // A rich fact used to be forced open, which turned a 22-fact set into
          // a wall nobody could scan. Collapsed it shows a SUMMARY — what it
          // holds and how many ways it is asked — so it is visible without
          // being hidden, and one tap opens the real editor.
          const simple = isSimple(row.fact)
          const expanded = row.expanded
          const slotNames = Object.keys(row.fact.slots)
          return (
            <li
              key={row.key}
              className={`editor__row${expanded || !simple ? ' editor__row--rich' : ''}`}
            >
              <span className="editor__row-num" aria-hidden="true">
                {index + 1}
              </span>

              {expanded ? (
                <div className="editor__rich">
                  <FactEditor
                    fact={row.fact}
                    index={index}
                    onChange={fact => patchFact(row.key, fact)}
                  />
                </div>
              ) : !simple ? (
                <button
                  type="button"
                  className="editor__summary"
                  onClick={() => toggleExpanded(row.key)}
                  aria-expanded={false}
                >
                  <span className="editor__summary-name">
                    {Object.values(row.fact.slots).find(v => v.trim() !== '') ?? '(empty)'}
                  </span>
                  <span className="editor__summary-meta">
                    {slotNames.join(' · ')}
                    {' — '}
                    {row.fact.questions?.length ?? slotNames.length} questions
                  </span>
                </button>
              ) : (
                <>
                  <input
                    className="field__input"
                    value={row.fact.slots[LEGACY_PROMPT_SLOT] ?? ''}
                    onChange={e =>
                      patchFact(row.key, {
                        ...row.fact,
                        slots: { ...row.fact.slots, [LEGACY_PROMPT_SLOT]: e.target.value }
                      })
                    }
                    placeholder="Front"
                    aria-label={`Fact ${index + 1} front`}
                  />
                  <input
                    className="field__input"
                    value={row.fact.slots[LEGACY_ANSWER_SLOT] ?? ''}
                    onChange={e =>
                      patchFact(row.key, {
                        ...row.fact,
                        slots: { ...row.fact.slots, [LEGACY_ANSWER_SLOT]: e.target.value }
                      })
                    }
                    placeholder="Back"
                    aria-label={`Fact ${index + 1} back`}
                  />
                </>
              )}

              <div className="editor__row-tools">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => toggleExpanded(row.key)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} fact ${index + 1}`}
                  title={
                    expanded
                      ? 'Collapse'
                      : simple
                        ? 'Add slots and questions'
                        : 'Edit slots and questions'
                  }
                >
                  {expanded ? '⌃' : '⌄'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => removeRow(row.key)}
                  aria-label={`Remove fact ${index + 1}`}
                >
                  ×
                </button>
              </div>

              {showExtras && !expanded && (
                <div className="editor__board-fields">
                  <select
                    className="field__input"
                    value={simpleTier(row.fact) ?? ''}
                    onChange={e =>
                      patchFact(
                        row.key,
                        withTier(row.fact, e.target.value === '' ? null : Number(e.target.value))
                      )
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
                    value={row.fact.detail ?? ''}
                    onChange={e =>
                      patchFact(row.key, { ...row.fact, detail: e.target.value || null })
                    }
                    placeholder="Detail shown after the answer (optional)"
                    maxLength={2000}
                    aria-label={`Fact ${index + 1} detail`}
                  />
                </div>
              )}
            </li>
          )
        })}
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
