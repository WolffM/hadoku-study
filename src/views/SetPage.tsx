/**
 * One set: what it is, and the ways in.
 *
 * The whole set — every card — arrives in the single fetch this view makes, so
 * that by the time "Study" is pressed there is nothing left to load. The drill
 * loop must never wait on the network between cards, and prefetching here is
 * how that is paid for.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, type StudyClient } from '../api/client'
import type { StudySetDetail } from '../api/types'
import { serializeSetFile, setFileName } from '../setFile'
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
  const exportFile = useCallback(() => {
    if (!set) return
    const url = URL.createObjectURL(new Blob([serializeSetFile(set)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = setFileName(set.title)
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
  }, [set])

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

      <h1 className="set-page__title">{set.title}</h1>
      {set.description && <p className="set-page__desc">{set.description}</p>}

      <p className="set-page__meta">
        {set.cardCount} {set.cardCount === 1 ? 'card' : 'cards'}
        {set.isOwner && (
          <span className={`badge ${set.published ? 'badge--success' : 'badge--neutral'}`}>
            {set.published ? 'Published' : 'Private'}
          </span>
        )}
      </p>

      {error !== null && (
        <p className="panel panel--error" role="alert">
          {error}
        </p>
      )}

      <div className="set-page__primary">
        {playable.length === 0 && <p className="muted">This set has no cards yet.</p>}
        {playable.map(({ game, summary }, index) => (
          <button
            key={game.id}
            type="button"
            /* The first playable mode is the primary action. For a plain deck
               that is Study; the registry's order decides, not this page. */
            className={`btn btn--lg btn--wide ${index === 0 ? 'btn--primary' : 'btn--ghost set-page__game-btn'}`}
            onClick={() => onPlay(game.id)}
          >
            {game.label}
            {summary && <span className="set-page__game-summary">{summary}</span>}
          </button>
        ))}
      </div>

      <div className="set-page__share">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={exportFile}
          disabled={set.cards.length === 0}
        >
          Export file
        </button>
        {set.published && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        )}
      </div>

      {set.isOwner && (
        <div className="set-page__owner">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            Edit cards
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
