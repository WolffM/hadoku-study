/**
 * What to tell an agent alongside a set.
 *
 * The JSON alone is not a brief. An agent handed raw content guesses at the
 * slot vocabulary, invents its own phrasing conventions, and — the expensive
 * one — drops the fact ids, which silently discards every rating the set has
 * earned. Each paragraph below exists because leaving it out produces a
 * specific, recognisable kind of bad output.
 *
 * Kept next to nothing else on purpose: this is prose, it will be edited by
 * reading it rather than by reasoning about types, and burying it inside a
 * component is what makes prose go stale.
 */

/** The slots the server can phrase without help. Mirrors KNOWN_SLOTS. */
const KNOWN_SLOTS = 'who, what, where, when, why, how, quote, term, definition'

const BRIEF = `This is a hadoku study set, in exactly the format it imports from. Improve it:
add facts, add angles to the facts that are there, and write better questions.

A FACT is a bundle of named slots — the things that are true about one event,
person or idea. A QUESTION over that fact names one slot as the answer ("ask")
and shows some of the rest ("given", which defaults to every other slot).

- Write a real "prompt" for every question. The fallback phrasings are plain on
  purpose, and a set that leans on them reads like a form rather than a quiz.
- Naming FEWER slots in "given" makes a harder question. The two rate
  independently, so both are worth having for a fact that supports it.
- Known slots, phrased automatically if you omit a prompt: ${KNOWN_SLOTS}.
  "why", "how" and "definition" are treated as answers you explain rather than
  name. Any other slot name works and simply needs a prompt.
- "seedTier" is 1-5 and only SEEDS difficulty. Play moves it from there, so an
  approximate tier is fine and a precise one is not worth agonising over.
- "detail" is the context revealed AFTER the answer — the why, never the answer.
- The asked slot is also a BOARD COLUMN: every question answering "when" makes
  up "Name that year". A set that asks several kinds of question can be played
  as a board with no tagging at all, so give facts a spread of askable slots.

KEEP EVERY FACT'S "id" EXACTLY AS IT APPEARS. Ratings and play history hang off
it, and a fact that comes back without its id is treated as a new one — silently
discarding everything the set has learned about it. New facts you add simply
have no id.

Return the whole document, in the same shape, with nothing else around it.

`

export function agentBrief(file: unknown): string {
  return `${BRIEF}${JSON.stringify(file, null, 2)}\n`
}
