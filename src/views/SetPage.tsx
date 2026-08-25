/**
 * One set: what it is, and the ways in.
 *
 * The whole set — every card — arrives in the single fetch this view makes, so
 * that by the time "Study" is pressed there is nothing left to load. The drill
 * loop must never wait on the network between cards, and prefetching here is
 * how that is paid for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, type StudyClient } from '../api/client'
import type { QuestionRating, StudySetDetail } from '../api/types'
import { toPlayCards } from '../model/playCards'
import { Standing } from '../components/Standing'
import { SetFileError, parseImport, setFileName } from '../setFile'
import { agentBrief } from '../agentBrief'
import { diffSet, type SetDiff } from '../model/diff'
import { lintSet, type SetReport } from '../model/lint'
import { UploadReview } from '../components/UploadReview'
import { GAMES, findGame } from '../games/registry'
import { Editor } from './Editor'

export interface SetPageProps {
  client: StudyClient
  setId: string
  /** The game being played, by id, or null for this page. */
  playing: string | null
  syncEnabled: boolean
  shuffle: boolean
  onPlay: (gameId: string) => void
  onLeavePlay: () => void
  onBack: () => void
  onDeleted: () => void
}

export function SetPage({
  client,
  setId,
  playing,
  syncEnabled,
  shuffle,
  onPlay,
  onLeavePlay,
  onBack,
  onDeleted
}: SetPageProps) {
  const [set, setSet] = useState<StudySetDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  /**
   * How the set is going. Null until fetched, and left null for a signed-out
   * reader — who has no ratings at all, so there is nothing to be waiting for.
   */
  const [ratings, setRatings] = useState<QuestionRating[] | null>(null)
  /**
   * An upload waiting to be confirmed.
   *
   * Parsed, linted and diffed BEFORE anything is sent — a PUT replaces content
   * wholesale, so the only place a person can see the difference between "the
   * new version" and "delete eleven facts" is here, in front of the button.
   */
  const [pending, setPending] = useState<{
    facts: Parameters<typeof diffSet>[1]['facts']
    title?: string
    description?: string | null
    diff: SetDiff
    report: SetReport
  } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadText, setUploadText] = useState('')
  const uploadInput = useRef<HTMLInputElement>(null)
  // Deleting takes a set, its cards and every reader's saved place with it,
  // and there is no undo. Two taps, not a modal — a confirm dialog on a phone
  // is a bigger interruption than the action warrants.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setMissing(false)
    client
      .getSet(setId)
      .then(setSet)
      .catch((err: unknown) => {
        // A set that does not exist and a private set belonging to someone else
        // are the same 404 by design — so they get the same words here. Saying
        // "private" would confirm the id is real.
        if (err instanceof ApiError && err.isMissing) setMissing(true)
        else setError(err instanceof Error ? err.message : 'Could not load this set')
      })
  }, [client, setId])

  useEffect(load, [load])

  /**
   * Ratings, for the standing panel.
   *
   * Separate from the set fetch on purpose: content is public and cacheable,
   * a rating is private to one reader, and folding them into one response
   * would make the set uncacheable for everyone to serve a panel only signed-in
   * readers see. Failure is silent — the panel simply does not appear, which
   * is the same thing a reader with nothing played sees.
   */
  useEffect(() => {
    if (!syncEnabled) return
    let cancelled = false
    void client
      .getRatings(setId)
      .then(fetched => {
        if (!cancelled) setRatings(fetched)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, setId, syncEnabled, playing])

  /**
   * Read an uploaded set and work out what it would do — without doing it.
   *
   * Everything the editor's import accepts is accepted here: a set file, a raw
   * API response, a bare array, a v1 export. What differs is the destination —
   * this REPLACES the set rather than appending to a draft, so it stops and
   * shows its working.
   */
  const review = useCallback(
    (text: string) => {
      if (!set) return
      let parsed
      try {
        parsed = parseImport(text)
      } catch (err: unknown) {
        setError(err instanceof SetFileError ? err.message : 'Could not read that as a set.')
        return
      }
      setError(null)
      setUploadOpen(false)
      setUploadText('')
      setPending({
        facts: parsed.facts,
        title: parsed.title,
        description: parsed.description,
        diff: diffSet(set, parsed),
        report: lintSet(parsed.facts)
      })
    },
    [set]
  )

  const uploadFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      file
        .text()
        .then(review)
        .catch(() => setError('Could not read that file.'))
      // Cleared so choosing the SAME file twice fires a change event the second
      // time — otherwise a rejected upload cannot be retried without picking a
      // different file first.
      if (uploadInput.current) uploadInput.current.value = ''
    },
    [review]
  )

  const confirmUpload = useCallback(() => {
    if (!set || !pending) return
    setUploading(true)
    client
      .replaceSet(set.id, {
        title: pending.title ?? set.title,
        // Undefined means the file did not mention it, which must not be read
        // as "clear it".
        description: pending.description === undefined ? set.description : pending.description,
        facts: pending.facts
      })
      .then(updated => {
        setSet(updated)
        setPending(null)
        setUploading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not save the set')
        setUploading(false)
      })
  }, [client, pending, set])

  const togglePublished = useCallback(() => {
    if (!set) return
    setBusy(true)
    client
      .updateSet(set.id, { published: !set.published })
      .then(updated => setSet(current => (current ? { ...current, ...updated } : current)))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not change visibility')
      )
      .finally(() => setBusy(false))
  }, [client, set])

  const remove = useCallback(() => {
    if (!set) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    client
      .deleteSet(set.id)
      .then(onDeleted)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not delete this set')
        setBusy(false)
      })
  }, [client, confirmingDelete, onDeleted, set])

  /**
   * Download the set as one file.
   *
   * Offered to anyone who can READ the set, not just its owner: a reader of a
   * published set already has every card on screen, so withholding the file
   * would protect nothing and only stop people building on each other's decks.
   * The file is the same document the API accepts back, so an export is a fork
   * waiting to happen.
   */
  const download = useCallback((text: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    // In the document, not just constructed: Firefox ignores a click on an
    // anchor that was never attached, and silently downloads nothing.
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoked on a turn of the event loop rather than immediately: Safari has
    // not started reading the blob by the time click() returns, and revoking
    // synchronously gives it an empty file.
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [])

  /**
   * Fetched, not built from the set already in memory.
   *
   * One idea of what an export contains, living on the server, so a file saved
   * from this button is byte-identical to one pulled with curl. A local
   * serializer would drift from the server's the first time either changed.
   */
  const exportFile = useCallback(() => {
    if (!set) return
    client
      .getFile(set.id)
      .then(file => download(`${JSON.stringify(file, null, 2)}\n`, setFileName(set.title)))
      .catch(() => setError('Could not build the file for this set.'))
  }, [client, download, set])

  /**
   * The file plus a paragraph telling an agent what to do with it.
   *
   * The set alone is not enough of a brief: an agent handed raw JSON guesses at
   * the slot vocabulary, invents its own phrasing conventions, and — worst —
   * drops the fact ids, which silently discards every rating the set has
   * earned. Saying so costs one paragraph.
   *
   * The button says "Copy JSON" because that is what it is FOR; the brief
   * riding in front of it is not worth a longer label. Do not strip it to make
   * the label literally true — `agentBrief.ts` explains what each paragraph
   * prevents, and the answer is never "nothing".
   */
  const copyJson = useCallback(() => {
    if (!set) return
    client
      .getFile(set.id)
      .then(async file => {
        await navigator.clipboard.writeText(agentBrief(file))
        setCopiedJson(true)
        window.setTimeout(() => setCopiedJson(false), 2000)
      })
      .catch(() => setError('Could not copy this set.'))
  }, [client, set])

  // Asked of the registry, not hard-coded: this page does not know what a
  // board is. Each game decides from the CARDS whether it can be played, so a
  // deck that gets tagged later starts offering a new mode on its own.
  const playable = useMemo(
    () =>
      set ? GAMES.map(game => ({ game, ...game.availability(set) })).filter(g => g.playable) : [],
    [set]
  )

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?set=${encodeURIComponent(setId)}`
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => setError('Could not copy the link — the browser refused clipboard access.'))
  }, [setId])

  if (missing) {
    return (
      <div className="panel">
        <h2 className="panel__title">Not found</h2>
        <p>That set does not exist, or it is private.</p>
        <button type="button" className="btn btn--ghost btn--lg" onClick={onBack}>
          Back to sets
        </button>
      </div>
    )
  }

  if (error !== null && !set) {
    return (
      <div className="panel panel--error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load}>
          Try again
        </button>
      </div>
    )
  }

  if (!set) return <p className="muted">Loading…</p>

  if (editing) {
    return (
      <Editor
        client={client}
        existing={set}
        onSaved={updated => {
          setSet(updated)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const game = findGame(playing)
  if (game) {
    const availability = game.availability(set)
    if (!availability.playable) {
      return (
        <div className="panel">
          <p>{availability.blocked ?? 'This set cannot be played that way yet.'}</p>
          <button type="button" className="btn btn--ghost btn--lg" onClick={onLeavePlay}>
            Back to set
          </button>
        </div>
      )
    }
    const { Component } = game
    return (
      <Component
        set={set}
        client={client}
        syncEnabled={syncEnabled}
        shuffle={shuffle}
        onExit={onLeavePlay}
      />
    )
  }

  return (
    <section className="set-page">
      <button type="button" className="btn btn--ghost btn--sm set-page__back" onClick={onBack}>
        ← All sets
      </button>

      <header className="set-page__head">
        <h1 className="set-page__title">{set.title}</h1>
        {set.description && <p className="set-page__desc">{set.description}</p>}
        <p className="set-page__meta">
          <span>
            {set.factCount} {set.factCount === 1 ? 'fact' : 'facts'}
          </span>
          {/* The number that decides how long a pass takes. A set of 25 facts
              asked four ways is a hundred things to get right, and the fact
              count alone hides that entirely. Shown only when it differs, so a
              plain deck reads as a plain deck. */}
          {set.variantCount !== set.factCount && (
            <span>
              {set.variantCount} {set.variantCount === 1 ? 'question' : 'questions'}
            </span>
          )}
          {set.isOwner && (
            <span className={`badge ${set.published ? 'badge--success' : 'badge--neutral'}`}>
              {set.published ? 'Published' : 'Private'}
            </span>
          )}
        </p>
      </header>

      {error !== null && (
        <p className="panel panel--error" role="alert">
          {error}
        </p>
      )}

      {playable.length === 0 ? (
        <p className="muted">This set has no cards yet.</p>
      ) : (
        <ul className="mode-list">
          {playable.map(({ game }) => {
            const { Preview } = game
            return (
              <li key={game.id}>
                {/* A tile, not a row of buttons. Picking how to study is a
                    CHOICE between modes, and two full-width slabs of the same
                    size gave no way to tell them apart or to see what either
                    one would be like. */}
                <button type="button" className="mode" onClick={() => onPlay(game.id)}>
                  <span className="mode__text">
                    <span className="mode__name">{game.label}</span>
                  </span>
                  {Preview && (
                    <span className="mode__preview">
                      <Preview set={set} />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {ratings !== null && (
        <Standing cards={toPlayCards(set.facts)} ratings={ratings} isOwner={set.isOwner} />
      )}

      {/* Quieter than the modes on purpose: taking a copy is a useful thing to
          be able to do, not a thing anyone came here for. */}
      <div className="set-page__tools">
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={exportFile}
          disabled={set.facts.length === 0}
        >
          Export file
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={copyJson}
          disabled={set.facts.length === 0}
        >
          {copiedJson ? 'JSON copied' : 'Copy JSON'}
        </button>
        {set.published && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        )}
      </div>

      {set.isOwner && pending !== null && (
        <UploadReview
          diff={pending.diff}
          report={pending.report}
          saving={uploading}
          onConfirm={confirmUpload}
          onCancel={() => setPending(null)}
        />
      )}

      {set.isOwner && uploadOpen && pending === null && (
        <div className="upload">
          <label className="field">
            <span className="field__label">
              Paste a set — what an agent handed back, an exported file, or a raw API response
            </span>
            <textarea
              className="field__input field__input--area"
              rows={6}
              value={uploadText}
              onChange={e => setUploadText(e.target.value)}
              placeholder='{ "title": …, "facts": [ … ] }'
            />
          </label>
          <div className="upload__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => uploadInput.current?.click()}
            >
              Choose a file
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => review(uploadText)}
              disabled={uploadText.trim() === ''}
            >
              Review changes
            </button>
          </div>
          {/* `hidden`, not clipped: the button above IS the accessible control,
              so leaving this in the tab order would offer a second unlabelled
              "Choose File" beside it. */}
          <input
            ref={uploadInput}
            type="file"
            hidden
            accept=".json,application/json,text/plain"
            onChange={e => uploadFile(e.target.files?.[0])}
          />
        </div>
      )}

      {set.isOwner && (
        <div className="set-page__owner">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            Edit set
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setUploadOpen(open => !open)}
            disabled={busy}
            aria-expanded={uploadOpen}
          >
            {uploadOpen ? 'Close upload' : 'Upload JSON'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={togglePublished}
            disabled={busy}
          >
            {set.published ? 'Make private' : 'Publish'}
          </button>
          <button
            type="button"
            className="btn btn--danger-ghost btn--sm"
            onClick={remove}
            onBlur={() => setConfirmingDelete(false)}
            disabled={busy}
          >
            {confirmingDelete ? 'Tap again to delete' : 'Delete'}
          </button>
        </div>
      )}

      {set.isOwner && set.published && (
        <p className="muted set-page__note">
          Anyone with the link can read and study this set, signed in or not.
        </p>
      )}
    </section>
  )
}
