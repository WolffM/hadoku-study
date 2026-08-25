/**
 * What an upload would actually do to a set.
 *
 * A PUT replaces a set's content wholesale, so "here is the new version" and
 * "delete eleven facts" look identical on the wire. The point of this module is
 * to make them look different to a person BEFORE they press the button.
 *
 * One comparison matters more than the rest. Ratings and attempt history hang
 * off `fact.id`, so a fact that comes back WITHOUT its id is not an edit — it
 * is a delete and a fresh insert, and everything the set had learned about it
 * is gone with no error anywhere. That is the single easiest mistake for an
 * agent to make, it is invisible in the JSON, and {@link orphanOf} is what
 * catches it.
 */

import type { FactInput, StudyFact } from '../api/types'

/** Questions a fact will be asked as. Declared, or one per slot if it declares
 *  nothing — mirroring the server's default expansion. */
export const questionCount = (fact: FactInput): number =>
  fact.questions?.length ?? Object.keys(fact.slots).length

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ')

/** Slot values, for judging whether two facts are "the same fact". */
const valueSet = (slots: Record<string, string>): Set<string> =>
  new Set(
    Object.values(slots)
      .map(normalise)
      .filter(value => value !== '')
  )

/**
 * How much two facts' content overlaps, 0..1.
 *
 * Compared by VALUE rather than by slot name, because the case this exists to
 * catch is a fact returned intact but stripped of its id — same words, same
 * everything, no id. Renamed slots should not hide that.
 */
export function similarity(a: Record<string, string>, b: Record<string, string>): number {
  const left = valueSet(a)
  const right = valueSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const value of left) if (right.has(value)) shared += 1
  return shared / Math.max(left.size, right.size)
}

/** Enough shared content to call it the same fact wearing a new id. Two facts
 *  about the Diet of Worms share a where and a when without being the same
 *  fact, so a majority of values has to match, not a couple. */
export const ORPHAN_THRESHOLD = 0.6

export type FactChange =
  | { kind: 'unchanged'; id: string; after: FactInput }
  | { kind: 'changed'; id: string; before: StudyFact; after: FactInput; notes: string[] }
  | {
      kind: 'added'
      after: FactInput
      /** The existing fact this looks like, when it arrived with no usable id.
       *  Present means history is about to be thrown away. */
      orphanOf?: StudyFact
    }
  | { kind: 'removed'; before: StudyFact }

/** What changed inside one fact, in words. */
function describe(before: StudyFact, after: FactInput): string[] {
  const notes: string[] = []

  const beforeSlots = Object.keys(before.slots)
  const afterSlots = Object.keys(after.slots)
  const added = afterSlots.filter(name => !beforeSlots.includes(name))
  const dropped = beforeSlots.filter(name => !afterSlots.includes(name))
  const edited = afterSlots.filter(
    name => beforeSlots.includes(name) && before.slots[name] !== after.slots[name]
  )

  if (added.length > 0) notes.push(`slots added: ${added.join(', ')}`)
  if (dropped.length > 0) notes.push(`slots removed: ${dropped.join(', ')}`)
  if (edited.length > 0) notes.push(`slots edited: ${edited.join(', ')}`)

  const wasAsked = before.variants.length
  const nowAsked = questionCount(after)
  if (nowAsked !== wasAsked) {
    notes.push(`asked ${wasAsked} ${wasAsked === 1 ? 'way' : 'ways'} → ${nowAsked}`)
  } else if (!sameJson(before.questions ?? null, after.questions ?? null)) {
    notes.push('questions reworded')
  }

  if ((before.detail ?? null) !== (after.detail ?? null)) notes.push('detail changed')
  if (!sameJson(before.attrs ?? null, after.attrs ?? null)) notes.push('game data changed')

  return notes
}

export interface FieldChange<T> {
  before: T
  after: T
}

export interface SetDiff {
  facts: FactChange[]
  counts: { unchanged: number; changed: number; added: number; removed: number }
  questionsBefore: number
  questionsAfter: number
  title: FieldChange<string> | null
  description: FieldChange<string | null> | null
  /** Facts arriving without a usable id that match an existing one — a
   *  delete-and-re-add that discards ratings. The number worth shouting. */
  orphaned: number
  /** Whether anything at all would change. */
  empty: boolean
}

export interface IncomingSet {
  title?: string
  description?: string | null
  facts: FactInput[]
}

export function diffSet(
  current: { title: string; description: string | null; facts: StudyFact[] },
  incoming: IncomingSet
): SetDiff {
  const byId = new Map(current.facts.map(fact => [fact.id, fact]))
  const matchedIds = new Set<string>()

  // First pass: everything that names an id we recognise.
  const changes: FactChange[] = []
  const unmatched: FactInput[] = []
  for (const after of incoming.facts) {
    const before = after.id ? byId.get(after.id) : undefined
    if (!before) {
      unmatched.push(after)
      continue
    }
    matchedIds.add(before.id)
    const notes = describe(before, after)
    changes.push(
      notes.length === 0
        ? { kind: 'unchanged', id: before.id, after }
        : { kind: 'changed', id: before.id, before, after, notes }
    )
  }

  const removed = current.facts.filter(fact => !matchedIds.has(fact.id))

  // Second pass: does an unmatched arrival look like something being removed?
  // If so it is not new — it is the same fact with its history cut off.
  const claimed = new Set<string>()
  for (const after of unmatched) {
    let best: StudyFact | undefined
    let bestScore = ORPHAN_THRESHOLD
    for (const candidate of removed) {
      if (claimed.has(candidate.id)) continue
      const score = similarity(candidate.slots, after.slots)
      if (score >= bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (best) claimed.add(best.id)
    changes.push({ kind: 'added', after, ...(best ? { orphanOf: best } : {}) })
  }

  for (const before of removed) changes.push({ kind: 'removed', before })

  const counts = {
    unchanged: changes.filter(c => c.kind === 'unchanged').length,
    changed: changes.filter(c => c.kind === 'changed').length,
    added: changes.filter(c => c.kind === 'added').length,
    removed: changes.filter(c => c.kind === 'removed').length
  }

  const title =
    incoming.title !== undefined && incoming.title !== current.title
      ? { before: current.title, after: incoming.title }
      : null
  const description =
    incoming.description !== undefined && (incoming.description ?? null) !== current.description
      ? { before: current.description, after: incoming.description ?? null }
      : null

  return {
    facts: changes,
    counts,
    questionsBefore: current.facts.reduce((total, fact) => total + fact.variants.length, 0),
    questionsAfter: incoming.facts.reduce((total, fact) => total + questionCount(fact), 0),
    title,
    description,
    orphaned: changes.filter(c => c.kind === 'added' && c.orphanOf !== undefined).length,
    empty:
      counts.changed === 0 &&
      counts.added === 0 &&
      counts.removed === 0 &&
      title === null &&
      description === null
  }
}
