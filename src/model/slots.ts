/**
 * The slot vocabulary, for the editor's benefit.
 *
 * A deliberate MIRROR of the worker's `KNOWN_SLOTS`, and the only place this
 * bundle keeps one. It exists because the editor has to hint — suggest a name
 * when you add a slot, and say whether a prompt is optional or required — and
 * asking the server mid-keystroke to answer that would be absurd.
 *
 * Drift here is cheap and visible, which is why the duplication is acceptable
 * where the variant-key duplication was not: if this list falls behind, a
 * placeholder says "optional" for a slot the server cannot phrase, and the
 * author writes a prompt they did not strictly need. Nothing is stored wrong
 * and no rating is affected. Compare `variantKey`, which is deliberately
 * server-only because a disagreement there splits a question's history in two
 * with no symptom at all.
 */

import type { FactInput, QuestionInput } from '../api/types'

/** Slots the server can phrase without a written prompt. */
export const KNOWN_SLOTS = [
  'who',
  'what',
  'where',
  'when',
  'why',
  'how',
  'quote',
  'term',
  'definition'
] as const

/** Slots whose answer is explained rather than named. */
export const OPEN_SLOTS = new Set(['why', 'how', 'definition'])

/**
 * What the server asks when a fact declares nothing: each slot in turn, giving
 * all the others.
 *
 * Materialised by the editor's "Write them out" button, so an author can start
 * from the default and edit it rather than typing it. A `given` is left
 * undefined precisely because that is what "all the others" means — writing
 * the list out explicitly would freeze it, and adding a slot later would then
 * silently fail to appear in any existing question.
 */
export const defaultQuestions = (slotNames: string[]): QuestionInput[] =>
  slotNames.map(ask => ({ ask }))

/**
 * Which slots a fact would be asked, for the editor's benefit.
 *
 * A MIRROR of the server's expansion, and hint-only — the editor uses it to
 * say what a set still needs before it can be a board, while it is being
 * typed and before anything has been saved. The authoritative expansion runs
 * on the server and comes back as `variants`.
 *
 * Same tradeoff as {@link KNOWN_SLOTS}: drift here is cheap and visible (the
 * hint is slightly wrong for a moment), where drift in a variant KEY would
 * split a question's rating history with no symptom at all.
 */
export function askedSlots(fact: FactInput): string[] {
  const declared = fact.questions
  if (!declared || declared.length === 0) return Object.keys(fact.slots)
  return [...new Set(declared.map(question => question.ask))].filter(ask => ask in fact.slots)
}
