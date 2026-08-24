/**
 * The shapes `/study/api` returns.
 *
 * Hand-kept mirrors of the worker's zod schemas rather than imports: the
 * frontend does not compile against the worker's tsconfig, and the worker
 * package is external to this bundle. The API is versioned by deploy, not by
 * semver, so the two move together.
 */

/** How a question went. Deliberately a string union, not a boolean — a third
 *  verdict is a widened union, not a migration. */
export type CardResult = 'got' | 'missed'

/**
 * Per-game attributes, keyed by game id.
 *
 * `unknown` per namespace on purpose: this bundle validates only the games it
 * ships (see each game's own module), and a namespace written by a newer
 * client round-trips untouched rather than being dropped. Read one with the
 * owning game's reader, never by reaching in directly.
 */
export type FactAttrs = Record<string, unknown>

/**
 * One question over a fact, as the server resolved it.
 *
 * Everything here is DERIVED — the server expands `slots` and `questions` on
 * every read. Nothing in this bundle builds a `key`, and nothing should: the
 * key is what ratings hang off, and a client that computed its own would
 * eventually disagree with the server about which question a rating belongs
 * to, silently, with no error anywhere.
 */
export interface StudyVariant {
  key: string
  /** Which slot is the answer. */
  ask: string
  /** The whole front, already phrased. */
  prompt: string
  answer: string
  /** Context to show beside the prompt, in the author's slot order. Empty for
   *  a migrated flashcard, whose prompt already IS the shown side. */
  given: { slot: string; value: string }[]
  /** Whether the answer is explained rather than named. */
  open: boolean
  /** Starting difficulty, 1–5. Seeds a rating; it is not a score. */
  seedTier: number
}

/**
 * A thing that is true, and the questions it can be asked as.
 *
 * The unit of storage. `slots` is what is true; `variants` is what you can be
 * asked about it. One fact yields several cards, which is the whole reason
 * this replaced a front/back row — front and back are a way of DRAWING a
 * variant, not a shape anything is stored in.
 */
export interface StudyFact {
  id: string
  slots: Record<string, string>
  /**
   * The declarations as AUTHORED — null when the fact declares none.
   *
   * Not the same thing as `variants`, and only this half is content. Exporting
   * from the resolved variants would bake the server's fallback phrasings in
   * as though someone had written them, so every round trip would quietly
   * freeze a template into the set.
   */
  questions?: QuestionInput[] | null
  /** Context revealed after the answer, never the answer itself. A first-class
   *  field rather than a namespace entry because every mode wants it. */
  detail?: string | null
  attrs?: FactAttrs | null
  variants: StudyVariant[]
}

export interface StudySet {
  id: string
  title: string
  description: string | null
  published: boolean
  factCount: number
  /** Absent on list entries — counting it means expanding every fact, and
   *  deriving it in SQL would be a second copy of the expansion rule. */
  variantCount?: number
  /** A convenience for rendering owner controls — never the seal. The worker
   *  re-derives ownership from the edge-injected userId on every write. */
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export interface StudySetDetail extends StudySet {
  variantCount: number
  facts: StudyFact[]
}

export interface StoredProgress {
  queue: string[]
  results: Record<string, CardResult>
  updatedAt: string
}

/** One declared question, as it travels in a file. */
export interface QuestionInput {
  ask: string
  given?: string[]
  prompt?: string
  open?: boolean
  seedTier?: number
}

export interface FactInput {
  /**
   * The id this fact already has, sent back so a save keeps its rating history.
   *
   * Absent on a fact that has never been saved. Dropping it on an existing one
   * is how you silently discard everything the set has learned about that
   * question — the server mints a new id, and the ratings hanging off the old
   * one are orphaned with no error.
   */
  id?: string
  slots: Record<string, string>
  /** Null and absent mean the same thing — ask every slot in turn. Null is
   *  accepted because that is what a fact with no declarations exports as. */
  questions?: QuestionInput[] | null
  detail?: string | null
  attrs?: FactAttrs | null
}
