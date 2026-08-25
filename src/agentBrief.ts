/**
 * What to tell an agent alongside a set.
 *
 * The JSON alone is not a brief. Every rule below exists because leaving it out
 * produces a specific, recognisable kind of bad output — and most of them were
 * learned the hard way, by making the mistake while writing this set with full
 * knowledge of the model. An agent seeing the format for the first time will
 * make them faster.
 *
 * Kept next to nothing else on purpose: this is prose, it will be edited by
 * reading it rather than by reasoning about types, and burying it inside a
 * component is what makes prose go stale.
 */

/** The slots the server can phrase without help. Mirrors KNOWN_SLOTS. */
const PHRASEABLE = 'who, what, where, when, why, how, quote, term, definition'

const BRIEF = `This is a hadoku study set, in exactly the format it imports from. Improve it:
add facts, add angles to the facts already there, and write better questions.
Return the whole document in the same shape, with nothing around it.

WHAT A FACT IS

A fact is ONE thing that is true — one event, person or idea — as a bundle of
named slots. A question over it names one slot as the answer ("ask") and may
show some of the others ("given").

    { "id": "worms",
      "slots": { "who": "Martin Luther", "what": "refused to recant",
                 "where": "the Diet of Worms", "when": "1521" },
      "questions": [
        { "ask": "when", "given": [], "seedTier": 2,
          "prompt": "In what year did Luther refuse to recant before the emperor?" }
      ] }

THE FIVE RULES THAT MATTER

1. KEEP EVERY FACT'S "id" EXACTLY AS IT IS. Ratings and play history hang off
   it. A fact returned without its id is treated as a new one, and everything
   the set has learned about it is silently discarded. New facts you add have
   no id — that is correct, leave it out.

2. NEVER PUT THE ANSWER IN THE PROMPT. This is easy to do by accident and it
   is invisible afterwards, because the question still reads well:

     BAD   ask "what"  -> "burned at Constance despite a promise of safe conduct"
           prompt: "What happened to Hus at Constance, despite a promise of
                    safe conduct?"
     GOOD  ask "what"  -> "condemned as a heretic and burned at the stake"
           prompt: "Hus came to Constance under an imperial promise of safe
                    conduct. What did the council do to him?"

   Watch for circular definitions too: "What was justification by faith built
   to answer?" answered by "the thing it was built to answer" is not a
   question. Name the thing.

3. "given" IS WHAT GETS DRAWN BESIDE THE PROMPT — not a hint about difficulty.
   If your prompt is a complete question on its own, use "given": [], or the
   same sentence prints twice: once large as the question and once small as
   context. A written prompt almost always wants "given": []. Name slots in
   "given" only when the prompt is deliberately short and leans on them
   ("In what year?" beside a "what" slot). Omitting "given" entirely means
   EVERY other slot, which is rarely what you want with a written prompt.

4. ONE FACT PER THING THAT IS TRUE. Do not describe one event with two facts —
   Hus being burned at Constance in 1415 is one fact asked several ways, not a
   "who said it" fact plus a "what year" fact. Splitting it means a board can
   ask about it twice, and it makes every rating half as informed. If two facts
   share a where AND a when, they are probably one fact.

5. WRITE A REAL PROMPT for every question. The fallback phrasings are plain on
   purpose, and a set that leans on them reads like a form rather than a quiz.

THE REST

- Slots phrased automatically if you omit a prompt:
  ${PHRASEABLE}.
  "why", "how" and "definition" are treated as answers you explain rather than
  name. Any other slot name works and simply needs a prompt.
- "seedTier" is 1-5 and only SEEDS difficulty. Play moves it from there, so an
  approximate tier is fine and a precise one is not worth agonising over.
- "detail" is the context revealed AFTER the answer — the why, never the answer.
- A BOARD COLUMN is an asked slot: every question answering "when" makes up
  "Name that year". A full board is 4 columns of 5, and NO FACT IS ASKED TWICE
  ON ONE BOARD — so a column needs 5 different facts that can answer it. Give
  facts a spread of askable slots, and prefer adding slots to existing facts
  over adding near-duplicate facts.
- Mark a question "open": true when its answer is explained rather than named.
  A board guarantees one such column, so a set with none is poorer for it.

The editor checks all of this on import and will list anything it finds, so a
mistake here costs a paste rather than a bad set.

`

export function agentBrief(file: unknown): string {
  return `${BRIEF}${JSON.stringify(file, null, 2)}\n`
}
