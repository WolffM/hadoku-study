/**
 * One set: what it is, and the ways in.
 *
 * The whole set — every card — arrives in the single fetch this view makes, so
 * that by the time "Study" is pressed there is nothing left to load. The drill
 * loop must never wait on the network between cards, and prefetching here is
 * how that is paid for.
 */

import { useCallback, useEffect, useState } from 'react'
import { ApiError, type StudyClient } from '../api/client'
import type { StudySetDetail } from '../api/types'
import { Drill } from './Drill'
import { Editor } from './Editor'

export interface SetPageProps {
  client: StudyClient
  setId: string
  drilling: boolean
  syncEnabled: boolean
  shuffle: boolean
  onStartDrill: () => void
  onLeaveDrill: () => void
  onBack: () => void
  onDeleted: () => void
}

export function SetPage({
  client,
  setId,
  drilling,
  syncEnabled,
  shuffle,
  onStartDrill,
  onLeaveDrill,
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

  if (drilling) {
    if (set.cards.length === 0) {
      return (
        <div className="panel">
          <p>This set has no cards yet.</p>
          <button type="button" className="btn btn--ghost btn--lg" onClick={onLeaveDrill}>
            Back to set
          </button>
        </div>
      )
    }
    return (
      <Drill
        set={set}
        client={client}
        syncEnabled={syncEnabled}
        shuffle={shuffle}
        onExit={onLeaveDrill}
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
        <button
          type="button"
          className="btn btn--primary btn--lg btn--wide"
          onClick={onStartDrill}
          disabled={set.cards.length === 0}
        >
          Study
        </button>
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
          {set.published && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          )}
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
