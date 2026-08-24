/**
 * A set as a single file.
 *
 * The format is not invented here — it is exactly what `GET /study/api/sets/:id`
 * returns, minus the fields the server derives. The API strips unknown keys
 * rather than rejecting them, so the same document a person downloads is a
 * valid create or replace body with nothing edited out. Keeping ONE shape is
 * the whole point: an agent, the editor and curl all move sets the same way.
 *
 * Reading is deliberately more forgiving than writing. What people actually
 * have on the clipboard is a raw API response, a spreadsheet column, a v1
 * export from before facts existed, or a file someone else wrote — so all of
 * those land, and only the shape we emit is canonical.
 */

import type { FactInput, QuestionInput, StudyFact, StudySetDetail } from './api/types'

export interface StudySetFile {
  title: string
  description?: string | null
  /** Omitted on a PUT means "leave visibility alone" — see the worker's
   *  ReplaceSetInput. Always written on export so a round trip loses nothing. */
  published?: boolean
  facts: FactInput[]
}

/**
 * The current format's version marker.
 *
 * 2 is facts. 1 was cards, and files in that shape still import — see
 * {@link factsFromCards} — because plenty of them exist on people's disks and
 * refusing them would strand sets that are perfectly convertible.
 */
export const SET_FILE_VERSION = 2

/** What a v1 card's two sides became. Named, because three places construct
 *  the pair and a typo in one of them is a silently broken import. */
export const LEGACY_PROMPT_SLOT = 'prompt'
export const LEGACY_ANSWER_SLOT = 'answer'

/** The seed tier a question gets when nothing says otherwise. Matches the
 *  worker's DEFAULT_SEED_TIER; the server clamps anyway. */
const DEFAULT_SEED_TIER = 3

/**
 * Serialize a set for download.
 *
 * `$schema` and `formatVersion` are metadata a reader can ignore: the API
 * strips both on import, so they cost nothing and give whoever opens the file
 * in an editor somewhere to look.
 *
 * `variants` is deliberately NOT written. It is derived from `slots` and
 * `questions` on every read, and a copy in the file would be a stale second
 * answer to what this fact asks — authoritative-looking, and wrong the moment
 * a slot is edited.
 */
export function toSetFile(set: StudySetDetail): Record<string, unknown> {
  return {
    $schema: 'https://hadoku.me/study/api/openapi.json#/components/schemas/CreateSetInput',
    formatVersion: SET_FILE_VERSION,
    title: set.title,
    description: set.description,
    published: set.published,
    facts: set.facts.map(toFactFile)
  }
}

/**
 * One fact, written only where it has something to say.
 *
 * `id` is written FIRST and always. Ratings and attempt history hang off it,
 * and a save replaces a set's facts wholesale — so a file that drops the ids
 * silently discards everything the set has learned. It is the one server-owned
 * field the API reads back rather than strips.
 */
function toFactFile(fact: StudyFact): Record<string, unknown> {
  const out: Record<string, unknown> = { id: fact.id, slots: fact.slots }
  if (fact.questions && fact.questions.length > 0) out.questions = fact.questions
  if (fact.detail) out.detail = fact.detail
  // Whole and unopened: this module has no business knowing which games exist,
  // and copying the bag verbatim is what lets a set authored by a newer client
  // survive a round trip through an older one.
  if (fact.attrs && Object.keys(fact.attrs).length > 0) out.attrs = fact.attrs
  return out
}

export function serializeSetFile(set: StudySetDetail): string {
  return `${JSON.stringify(toSetFile(set), null, 2)}\n`
}

/**
 * A filename that survives a Downloads folder.
 *
 * The title goes in so a folder of exports is readable, but it is a
 * user-supplied string that may hold slashes, quotes or emoji — so everything
 * outside a small safe set is collapsed rather than escaped.
 */
export function setFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'study-set'}.json`
}

/** A two-slot fact — the shape a flashcard has always had, named properly. */
export function flashcard(front: string, back: string): FactInput {
  return { slots: { [LEGACY_PROMPT_SLOT]: front, [LEGACY_ANSWER_SLOT]: back } }
}

/**
 * Split delimited text into facts.
 *
 * Tab first, because that is what a spreadsheet, a Google Sheet and Anki all
 * produce on copy — the realistic way anyone arrives with 200 cards already
 * written. A comma fallback covers hand-typed lines; anything after the first
 * separator stays with the answer, so "cat, the animal" survives intact.
 */
export function parseDelimited(text: string): FactInput[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const at = line.includes('\t') ? line.indexOf('\t') : line.indexOf(',')
      if (at === -1) return flashcard(line, '')
      return flashcard(line.slice(0, at).trim(), line.slice(at + 1).trim())
    })
    .filter(fact => fact.slots[LEGACY_PROMPT_SLOT] !== '')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Find the set inside whatever was handed over.
 *
 * `curl <url> > set.json` writes the whole wrapped envelope, and telling
 * someone their own export is the wrong shape — when we can plainly see the set
 * inside it — is a pointless obstacle. Unwraps `{success, data: {set}}` and
 * `{data: {set}}` and `{set}`, then stops.
 */
function unwrap(value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) return current
    const next = current.data ?? current.set
    if (next === undefined) return current
    current = next
  }
  return current
}

/** Slot values are strings; anything else in the JSON is dropped rather than
 *  stringified into "[object Object]" on someone's board. */
function readSlots(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [name, slot] of Object.entries(value)) {
    if (typeof slot === 'string' && slot.trim() !== '') out[name] = slot.trim()
  }
  return out
}

function readQuestions(value: unknown): QuestionInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter(isRecord).flatMap((q): QuestionInput[] => {
    if (typeof q.ask !== 'string' || q.ask.trim() === '') return []
    const question: QuestionInput = { ask: q.ask.trim() }
    if (Array.isArray(q.given)) {
      question.given = q.given.filter((g): g is string => typeof g === 'string')
    }
    if (typeof q.prompt === 'string' && q.prompt.trim() !== '') question.prompt = q.prompt.trim()
    if (typeof q.open === 'boolean') question.open = q.open
    if (typeof q.seedTier === 'number') question.seedTier = q.seedTier
    return [question]
  })
  return out.length > 0 ? out : undefined
}

function readFacts(value: unknown): FactInput[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map(raw => {
      const fact: FactInput = { slots: readSlots(raw.slots) }
      // Carried so a re-import keeps the set's rating history. A file that
      // never had one simply has no history to keep.
      if (typeof raw.id === 'string' && raw.id !== '') fact.id = raw.id
      const questions = readQuestions(raw.questions)
      if (questions) fact.questions = questions
      if (typeof raw.detail === 'string' && raw.detail.trim() !== '')
        fact.detail = raw.detail.trim()
      // Validating a namespace here would mean this module knowing every game,
      // and would silently drop one authored by a newer client — each game
      // validates its own on read.
      if (isRecord(raw.attrs) && Object.keys(raw.attrs).length > 0) fact.attrs = raw.attrs
      return fact
    })
    .filter(fact => Object.keys(fact.slots).length >= 2)
}

/**
 * Convert a v1 file's cards into facts.
 *
 * Exactly what migration 0003 did to the database, so a file exported before
 * facts existed lands as the same rows a v1 set became. Two slots, one declared
 * question asking the answer and giving the prompt — which renders the card
 * that was there before, rather than the reverse card the default expansion
 * would also generate.
 *
 * `attrs.board.difficulty` moves to the question's `seedTier`, where a tier
 * belongs now that ratings exist. The server REJECTS a stray `difficulty` in
 * the board namespace, so leaving it in place would fail the whole import —
 * loudly, which is right, but this file can convert it and nobody needs to see
 * the error.
 */
export function factsFromCards(value: unknown): FactInput[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map(card => {
      const front = typeof card.front === 'string' ? card.front.trim() : ''
      const back = typeof card.back === 'string' ? card.back.trim() : ''
      const fact = flashcard(front, back)

      const board = isRecord(card.attrs) && isRecord(card.attrs.board) ? card.attrs.board : null
      const difficulty =
        typeof board?.difficulty === 'number' ? board.difficulty : DEFAULT_SEED_TIER

      fact.questions = [
        { ask: LEGACY_ANSWER_SLOT, given: [LEGACY_PROMPT_SLOT], seedTier: difficulty }
      ]
      if (typeof card.detail === 'string' && card.detail.trim() !== '')
        fact.detail = card.detail.trim()

      if (isRecord(card.attrs)) {
        const attrs = { ...card.attrs }
        if (board) {
          const { difficulty: _moved, ...rest } = board
          // A board namespace holding only a difficulty has nothing left to say
          // once it has moved, and an empty namespace is not the same as none.
          if (Object.keys(rest).length > 0) attrs.board = rest
          else delete attrs.board
        }
        if (Object.keys(attrs).length > 0) fact.attrs = attrs
      }

      return fact
    })
    .filter(fact => fact.slots[LEGACY_PROMPT_SLOT] !== '' || fact.slots[LEGACY_ANSWER_SLOT] !== '')
}

export interface ParsedImport {
  /** Absent when the source carried only content — a pasted spreadsheet
   *  column, or a bare JSON array. The editor keeps whatever title it has. */
  title?: string
  description?: string | null
  facts: FactInput[]
}

export class SetFileError extends Error {}

/** Read facts out of a document that may be in either format. */
function factsFromDocument(root: Record<string, unknown>): FactInput[] {
  const facts = readFacts(root.facts)
  if (facts.length > 0) return facts
  return factsFromCards(root.cards)
}

/**
 * Read a pasted or uploaded set.
 *
 * One entry point for every source, because from the outside they are the same
 * gesture — "here is my set" — and a UI that makes someone pick the right
 * importer first is a UI that gets the choice wrong for them. JSON is tried
 * first and delimited text is the fallback, which is unambiguous: a spreadsheet
 * paste never parses as JSON.
 */
export function parseImport(text: string): ParsedImport {
  const trimmed = text.trim()
  if (trimmed === '') throw new SetFileError('Nothing to import.')

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new SetFileError('That looks like JSON, but it could not be parsed.')
    }

    const root = unwrap(parsed)

    // A bare array is content with no metadata around it — and may be in
    // either format, so both readers get a turn.
    if (Array.isArray(root)) {
      const facts = readFacts(root)
      const usable = facts.length > 0 ? facts : factsFromCards(root)
      if (usable.length === 0) throw new SetFileError('That JSON array holds no facts.')
      return { facts: usable }
    }

    if (!isRecord(root)) throw new SetFileError('That JSON is not a set.')

    const facts = factsFromDocument(root)
    if (facts.length === 0) {
      throw new SetFileError('That JSON has no `facts` array — is it a set file?')
    }

    return {
      title:
        typeof root.title === 'string' && root.title.trim() !== '' ? root.title.trim() : undefined,
      description: typeof root.description === 'string' ? root.description : undefined,
      facts
    }
  }

  const facts = parseDelimited(trimmed)
  if (facts.length === 0) throw new SetFileError('No facts found in that text.')
  return { facts }
}
