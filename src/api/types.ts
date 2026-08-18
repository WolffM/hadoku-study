/**
 * The shapes `/study/api` returns.
 *
 * Hand-kept mirrors of the worker's zod schemas rather than imports: the
 * frontend does not compile against the worker's tsconfig, and the worker
 * package is external to this bundle. The API is versioned by deploy, not by
 * semver, so the two move together.
 */

/** How a card went. Deliberately a string union, not a boolean — v2 judges
 *  typed answers with an LLM and needs a third verdict, and widening a union
 *  is not a migration. */
export type CardResult = 'got' | 'missed'

export interface StudyCard {
  id: string
  front: string
  back: string
}

export interface StudySet {
  id: string
  title: string
  description: string | null
  published: boolean
  cardCount: number
  /** A convenience for rendering owner controls — never the seal. The worker
   *  re-derives ownership from the edge-injected userId on every write. */
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export interface StudySetDetail extends StudySet {
  cards: StudyCard[]
}

export interface StoredProgress {
  queue: string[]
  results: Record<string, CardResult>
  updatedAt: string
}

export interface CardInput {
  front: string
  back: string
}
