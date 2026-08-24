/**
 * The small operations an editor performs on a fact.
 *
 * Extracted because two components need them — the row and the expanded
 * editor both read and write a board category, and a second copy of that had
 * already appeared before this file existed. Pure, so they can be tested
 * without rendering anything.
 */

import type { FactInput } from '../api/types'
import { BOARD_NAMESPACE } from '../games/board'
import { LEGACY_ANSWER_SLOT, LEGACY_PROMPT_SLOT } from '../setFile'

/**
 * Whether a fact is the plain flashcard two text inputs can hold.
 *
 * Exactly two slots, named the way the v1 backfill named them, asked one way.
 * Anything else — an extra slot, a second question, an unfamiliar `ask` — has
 * authoring in it that a front and a back cannot express.
 */
export function isSimple(fact: FactInput): boolean {
  const names = Object.keys(fact.slots)
  if (names.length !== 2) return false
  if (!names.includes(LEGACY_PROMPT_SLOT) || !names.includes(LEGACY_ANSWER_SLOT)) return false
  const questions = fact.questions
  if (!questions || questions.length === 0) return true
  return questions.length === 1 && questions[0].ask === LEGACY_ANSWER_SLOT
}

export const blankFact = (): FactInput => ({
  slots: { [LEGACY_PROMPT_SLOT]: '', [LEGACY_ANSWER_SLOT]: '' },
  // ALWAYS declared, never left to the default expansion — which would also
  // generate the reverse question and quietly double the set.
  questions: [{ ask: LEGACY_ANSWER_SLOT, given: [LEGACY_PROMPT_SLOT] }]
})

export function readCategory(fact: FactInput): string {
  const raw = fact.attrs?.[BOARD_NAMESPACE]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ''
  const { category } = raw as Record<string, unknown>
  return typeof category === 'string' ? category : ''
}

/**
 * Set or clear the board category, leaving other games' namespaces alone.
 *
 * An empty category REMOVES the namespace rather than storing a blank one:
 * a blank would render as a nameless column, and an empty bag is not the same
 * thing as no bag.
 */
export function withCategory(fact: FactInput, category: string): FactInput {
  const attrs: Record<string, unknown> = { ...fact.attrs }
  const clean = category.trim()
  if (clean === '') delete attrs[BOARD_NAMESPACE]
  else attrs[BOARD_NAMESPACE] = { category: clean }
  return { ...fact, attrs: Object.keys(attrs).length > 0 ? attrs : null }
}

/** The single declared question of a flashcard, which is where its tier lives
 *  now that a tier seeds a rating rather than naming a board row. */
export const simpleTier = (fact: FactInput): number | null => fact.questions?.[0]?.seedTier ?? null

export function withTier(fact: FactInput, tier: number | null): FactInput {
  const base = fact.questions?.[0] ?? { ask: LEGACY_ANSWER_SLOT, given: [LEGACY_PROMPT_SLOT] }
  return { ...fact, questions: [{ ...base, seedTier: tier ?? undefined }] }
}

/**
 * Rename a slot without losing its place.
 *
 * Rebuilt in order rather than deleted-and-re-added, because slot order is the
 * order context is shown in and a rename that sent a slot to the bottom would
 * silently reorder the question it appears in. Declarations name slots by
 * string, so they are carried through too — otherwise a rename leaves the
 * question naming a slot that no longer exists, and it stops resolving.
 */
export function renameSlot(fact: FactInput, from: string, to: string): FactInput {
  const clean = to.trim()
  // A blank or colliding name would silently merge two slots into one.
  if (clean === '' || clean === from || clean in fact.slots) return fact

  const slots: Record<string, string> = {}
  for (const [name, value] of Object.entries(fact.slots)) {
    slots[name === from ? clean : name] = value
  }

  return {
    ...fact,
    slots,
    questions: fact.questions?.map(question => ({
      ...question,
      ask: question.ask === from ? clean : question.ask,
      ...(question.given ? { given: question.given.map(g => (g === from ? clean : g)) } : {})
    }))
  }
}

/** Drop a slot, and any declaration that can no longer resolve without it. */
export function removeSlot(fact: FactInput, name: string): FactInput {
  const slots = { ...fact.slots }
  delete slots[name]
  return {
    ...fact,
    slots,
    // A declaration whose asked slot is gone renders nothing, so it goes with
    // it rather than lingering as an invisible entry.
    questions: fact.questions
      ?.filter(question => question.ask !== name)
      .map(question =>
        question.given ? { ...question, given: question.given.filter(g => g !== name) } : question
      )
  }
}

/** Trim on the way out, so a hand-edited fact does not store ragged
 *  whitespace and an all-spaces slot reads as the empty one it is. */
export function cleaned(fact: FactInput): FactInput {
  const slots: Record<string, string> = {}
  for (const [name, value] of Object.entries(fact.slots)) {
    const trimmed = value.trim()
    if (trimmed !== '') slots[name] = trimmed
  }
  const detail = fact.detail?.trim()
  return { ...fact, slots, detail: detail === '' ? null : (detail ?? null) }
}

/** A fact nobody has typed into. */
export const isBlank = (fact: FactInput): boolean =>
  Object.values(fact.slots).every(value => value.trim() === '') && (fact.detail ?? '') === ''

/** What is wrong with a fact, phrased for a person. Null when nothing is. */
export function factIssue(fact: FactInput): string | null {
  const filled = Object.values(fact.slots).filter(value => value.trim() !== '').length
  if (filled >= 2) return null
  return isSimple(fact) ? 'is missing a side' : 'needs at least two slots filled in'
}
