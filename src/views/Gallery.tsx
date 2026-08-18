/**
 * The landing view: your sets, and everything anyone has published.
 *
 * The published half loads for signed-out visitors too — that is the whole
 * point of publishing, and it is the surface a shared link's reader lands on if
 * they go looking for more.
 */

import { useCallback, useEffect, useState } from 'react'
import type { StudyClient } from '../api/client'
import type { StudySet } from '../api/types'

export interface GalleryProps {
  client: StudyClient
  canAuthor: boolean
  onOpen: (setId: string) => void
  onCreate: () => void
}

interface Loaded {
  mine: StudySet[]
  published: StudySet[]
}

export function Gallery({ client, canAuthor, onOpen, onCreate }: GalleryProps) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    // Both lists at once. They are independent, and the published half must not
    // wait on a request that only a signed-in user even makes.
    Promise.all([
      canAuthor ? client.listMySets() : Promise.resolve<StudySet[]>([]),
      client.listPublished()
    ])
      .then(([mine, published]) => setData({ mine, published }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load sets'))
  }, [canAuthor, client])

  useEffect(load, [load])

  if (error !== null) {
    return (
      <div className="panel panel--error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load}>
          Try again
        </button>
      </div>
    )
  }

  if (!data) return <p className="muted">Loading sets…</p>

  // A published set of someone else's should not appear twice when the viewer
  // is also its owner.
  const mineIds = new Set(data.mine.map(set => set.id))
  const others = data.published.filter(set => !mineIds.has(set.id))

  return (
    <div className="gallery">
      {canAuthor && (
        <section className="gallery__section">
          <div className="gallery__section-head">
            <h2 className="gallery__heading">Your sets</h2>
            <button type="button" className="btn btn--primary btn--sm" onClick={onCreate}>
              New set
            </button>
          </div>

          {data.mine.length === 0 ? (
            <p className="muted">
              Nothing yet. A set is a title and a stack of two-sided cards — make one.
            </p>
          ) : (
            <ul className="set-list">
              {data.mine.map(set => (
                <SetTile key={set.id} set={set} onOpen={onOpen} showVisibility />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="gallery__section">
        <h2 className="gallery__heading">Published</h2>
        {others.length === 0 ? (
          <p className="muted">No published sets yet.</p>
        ) : (
          <ul className="set-list">
            {others.map(set => (
              <SetTile key={set.id} set={set} onOpen={onOpen} showVisibility={false} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SetTile({
  set,
  onOpen,
  showVisibility
}: {
  set: StudySet
  onOpen: (setId: string) => void
  showVisibility: boolean
}) {
  return (
    <li className="set-tile">
      <button type="button" className="set-tile__button" onClick={() => onOpen(set.id)}>
        <span className="set-tile__title">{set.title}</span>
        {set.description && <span className="set-tile__desc">{set.description}</span>}
        <span className="set-tile__meta">
          <span>
            {set.cardCount} {set.cardCount === 1 ? 'card' : 'cards'}
          </span>
          {showVisibility && (
            <span className={`badge ${set.published ? 'badge--success' : 'badge--neutral'}`}>
              {set.published ? 'Published' : 'Private'}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
