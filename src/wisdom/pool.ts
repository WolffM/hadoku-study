/**
 * The passages /wisdom may show — every one of them read and chosen by hand.
 *
 * This is deliberately short. A tradition is not represented here until it has
 * been studied: the research dossiers in `research/traditions/` are where
 * candidates wait, and a passage moves from there to here only once it has been
 * read in context and judged worth showing. A tradition with nothing here is
 * drawn as an unlit star — that is the honest state, not a gap to fill.
 *
 * Text is copied verbatim from the named translation. Prefer public-domain
 * translations: this page is public.
 *
 * `id` is what a shared link carries (`/wisdom?w=<id>`), so never rename one.
 */

export interface Wisdom {
  /** Stable slug. Shared links point at it — never rename. */
  id: string
  /** A `Tradition.id` from traditions.ts. */
  tradition: string
  /** The passage, verbatim. Separate paragraphs (or verses) with a blank line. */
  text: string
  /** Where it is found, e.g. "John 3:19–21". */
  source: string
  /** Whose words these are in English, e.g. "World English Bible". */
  translation?: string
  /** A personal reflection, shown under the passage. Optional, and mine. */
  note?: string
  /** Ids of other entries this one speaks to — the bridges between traditions. */
  bridges?: string[]
}

export const POOL: readonly Wisdom[] = [
  {
    id: 'john-3-19',
    tradition: 'christianity',
    source: 'John 3:19–21',
    translation: 'World English Bible',
    text:
      'This is the judgment, that the light has come into the world, and men loved the darkness rather than the light, for their works were evil.\n\n' +
      'For everyone who does evil hates the light and doesn’t come to the light, lest his works would be exposed.\n\n' +
      'But he who does the truth comes to the light, that his works may be revealed, that they have been done in God.'
  }
]
