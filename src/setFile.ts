/**
 * A set as a single file.
 *
 * The format is not invented here — it is exactly what `GET /study/api/sets/:id`
 * returns, minus the fields the server owns. The API strips unknown keys rather
 * than rejecting them, so the same document a person downloads is a valid
 * create or replace body with nothing edited out. Keeping ONE shape is the
 * whole point: an agent, the editor and curl all move sets the same way.
 *
 * Reading is deliberately more forgiving than writing. What people actually
 * have on the clipboard is a raw API response, a spreadsheet column, or a file
 * someone else exported — so all of those land, and only the shape we emit is
 * canonical.
 */

import type { CardInput, StudySetDetail } from './api/types'

export interface StudySetFile {
  title: string
  description?: string | null
  /** Omitted on a PUT means "leave visibility alone" — see the worker's
   *  ReplaceSetInput. Always written on export so a round trip loses nothing. */
  published?: boolean
  cards: CardInput[]
}

/** The current format's version marker. */
export const SET_FILE_VERSION = 1

/**
 * Serialize a set for download.
 *
 * `$schema` and `version` are metadata a reader can ignore: the API strips both
 * on import, so they cost nothing and give whoever opens the file in an editor
 * somewhere to look. They are NOT read back — a file without them imports just
 * the same, because plenty of useful files will be hand-written or produced by
 * curl straight off the API.
 */
export function toSetFile(set: StudySetDetail): Record<string, unknown> {
  return {
    $schema: 'https://hadoku.me/study/api/openapi.json#/components/schemas/CreateSetInput',
    version: SET_FILE_VERSION,
    title: set.title,
    description: set.description,
    published: set.published,
    // Written only where they exist, so a plain flashcard deck exports as a
    // plain flashcard deck rather than a wall of nulls.
    cards: set.cards.map(card => {
      const out: Record<string, unknown> = { front: card.front, back: card.back }
      if (card.detail) out.detail = card.detail
      // Whole and unopened: this module has no business knowing which games
      // exist, and copying the bag verbatim is what lets a set authored by a
      // newer client survive a round trip through an older one.
      if (card.attrs && Object.keys(card.attrs).length > 0) out.attrs = card.attrs
      return out
    })
  }
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

/**
 * Split delimited text into cards.
 *
 * Tab first, because that is what a spreadsheet, a Google Sheet and Anki all
 * produce on copy — the realistic way anyone arrives with 200 cards already
 * written. A comma fallback covers hand-typed lines; anything after the first
 * separator stays with the back, so "cat, the animal" survives intact.
 */
export function parseDelimited(text: string): CardInput[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const at = line.includes('\t') ? line.indexOf('\t') : line.indexOf(',')
      if (at === -1) return { front: line, back: '' }
      return { front: line.slice(0, at).trim(), back: line.slice(at + 1).trim() }
    })
    .filter(card => card.front !== '')
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

function readCards(value: unknown): CardInput[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map(card => {
      const out: CardInput = {
        front: typeof card.front === 'string' ? card.front.trim() : '',
        back: typeof card.back === 'string' ? card.back.trim() : ''
      }
      if (typeof card.detail === 'string' && card.detail.trim() !== '') {
        out.detail = card.detail.trim()
      }
      // Carried through whole. Validating a namespace here would mean this
      // module knowing every game, and would silently drop one authored by a
      // client newer than this bundle — each game validates its own on read.
      if (isRecord(card.attrs) && Object.keys(card.attrs).length > 0) {
        out.attrs = card.attrs
      }
      return out
    })
    .filter(card => card.front !== '' || card.back !== '')
}

export interface ParsedImport {
  /** Absent when the source carried only cards — a pasted spreadsheet column,
   *  or a bare JSON array. The editor keeps whatever title it already has. */
  title?: string
  description?: string | null
  cards: CardInput[]
}

export class SetFileError extends Error {}

/**
 * Read a pasted or uploaded set.
 *
 * One entry point for every source, because from the outside they are the same
 * gesture — "here are my cards" — and a UI that makes someone pick the right
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

    // A bare array is a deck with no metadata around it.
    if (Array.isArray(root)) {
      const cards = readCards(root)
      if (cards.length === 0) throw new SetFileError('That JSON array holds no cards.')
      return { cards }
    }

    if (!isRecord(root)) throw new SetFileError('That JSON is not a set.')

    const cards = readCards(root.cards)
    if (cards.length === 0) {
      throw new SetFileError('That JSON has no `cards` array — is it a set file?')
    }

    return {
      title:
        typeof root.title === 'string' && root.title.trim() !== '' ? root.title.trim() : undefined,
      description: typeof root.description === 'string' ? root.description : undefined,
      cards
    }
  }

  const cards = parseDelimited(trimmed)
  if (cards.length === 0) throw new SetFileError('No cards found in that text.')
  return { cards }
}
