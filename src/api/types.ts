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

/**
 * Per-game attributes, keyed by game id.
 *
 * `unknown` per namespace on purpose: this bundle validates only the games it
 * ships (see each game's own module), and a namespace written by a newer
 * client round-trips untouched rather than being dropped. Read one with the
 * owning game's reader, never by reaching in directly.
 */
export type CardAttrs = Record<string, unknown>

export interface StudyCard {
  id: string
  front: string
  back: string
  /** Context revealed after the answer, never the answer itself. A first-class
   *  field rather than a namespace entry because every mode wants it. */
  detail?: string | null
  attrs?: CardAttrs | null
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
  detail?: string | null
  attrs?: CardAttrs | null
}
