/**
 * D1 access helpers and the visibility rules every route shares.
 */

import type { FactRow, ProgressRow, RatingRow, SetRow } from './types.js';

/** Facts per set. A set is meant to be prefetched whole on entry. */
export const MAX_FACTS_PER_SET = 500;
export const MAX_FIELD_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 120;
/**
 * Slots on one fact.
 *
 * Twelve is far past what anyone writes — a fact is a who/what/where/when and
 * maybe a why — but the default expansion asks EVERY slot in turn, so this is
 * also the cap on how many questions an undeclared fact can produce. Without
 * it a hand-written file with fifty slots is a fifty-question fact nobody
 * asked for.
 */
export const MAX_SLOTS_PER_FACT = 12;
/** Declared questions on one fact. Generous next to the slot cap, since
 *  dropping givens legitimately yields several questions per asked slot. */
export const MAX_QUESTIONS_PER_FACT = 24;
/** A slot name. Short: it is an identifier inside a variant key, not prose. */
export const MAX_SLOT_NAME_LENGTH = 40;

/**
 * Answers in one POST.
 *
 * The client sends one per answer — a board is twenty small writes on a site
 * with this traffic, and batching to the end of a session means an abandoned
 * game loses everything it learned. The batch form exists only so a
 * localStorage outbox can flush what it held while offline, which is why the
 * cap is modest rather than generous.
 */
export const MAX_ATTEMPTS_PER_REQUEST = 50;

/**
 * Serialized `facts.attrs`, in characters.
 *
 * The attrs bag passes unknown game namespaces through unvalidated so a new
 * mode needs no schema change. That flexibility is exactly what makes a cap
 * necessary: without one the column is an unbounded blob store that any
 * friend-tier caller can fill. Generous next to what a game actually needs —
 * the board uses about 50 characters — and still 500 facts' worth is under a
 * megabyte.
 */
export const MAX_ATTRS_LENGTH = 2000;
export const MAX_DESCRIPTION_LENGTH = 500;

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/**
 * Short, URL-safe id.
 *
 * Ids appear in shared links (`/study?set=<id>`), so they are short and read
 * cleanly aloud — no look-alike characters (`l`, `1`, `0`, `o`). They are NOT
 * a capability: a private set is sealed by the owner check in
 * {@link loadSetForRead}, not by an unguessable id. 12 chars of this alphabet
 * is ~60 bits, which is only about keeping the namespace collision-free.
 */
export function newId(length = 12): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = '';
	for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
	return out;
}

/**
 * The registry userId edge-router injects, or null for an anonymous caller.
 *
 * Rows bind to this, never to a raw key: a key can rotate, the userId does not.
 * edge-router strips any client-supplied `X-User-Id` before re-stamping the
 * real one, so the header is trustworthy — but ONLY because `createEdgeAuth`
 * has already verified `X-Edge-Auth` provenance on this request. On a direct
 * *.workers.dev hit provenance fails, the tier degrades to `public`, and every
 * route that consumes a userId is gated at friend+ and so 403s before reaching
 * here.
 */
export function userIdOf(req: Request): string | null {
	const raw = req.headers.get('X-User-Id');
	return raw && raw.trim() !== '' ? raw.trim() : null;
}

export interface SetWithCount extends SetRow {
	fact_count: number;
}

/**
 * Load a set for READING.
 *
 * Returns the set when it is published (anyone, including signed-out) or when
 * the caller owns it. Returns null both when the set does not exist and when
 * it exists but is private and not the caller's — the caller cannot tell those
 * apart, which is the point: a stranger probing set ids learns nothing about
 * which ones are real.
 */
export async function loadSetForRead(
	db: D1Database,
	setId: string,
	userId: string | null
): Promise<SetRow | null> {
	const row = await db
		.prepare(
			`SELECT * FROM sets
			 WHERE id = ?1 AND (published_at IS NOT NULL OR owner_user_id = ?2)`
		)
		// A null userId must not match `owner_user_id = NULL` by accident; it
		// cannot in SQL (NULL = NULL is NULL, not true), but binding the empty
		// string makes that explicit rather than incidental.
		.bind(setId, userId ?? '')
		.first<SetRow>();
	return row ?? null;
}

/**
 * Load a set the caller may MODIFY — owner only.
 *
 * Same conflation as {@link loadSetForRead}: a set someone else owns is
 * reported as absent, so the 404 a stranger gets is identical whether or not
 * the id exists.
 */
export async function loadSetForWrite(
	db: D1Database,
	setId: string,
	userId: string
): Promise<SetRow | null> {
	const row = await db
		.prepare(`SELECT * FROM sets WHERE id = ?1 AND owner_user_id = ?2`)
		.bind(setId, userId)
		.first<SetRow>();
	return row ?? null;
}

export async function listFacts(db: D1Database, setId: string): Promise<FactRow[]> {
	const res = await db
		.prepare(`SELECT * FROM facts WHERE set_id = ?1 ORDER BY position ASC`)
		.bind(setId)
		.all<FactRow>();
	return res.results;
}

export async function listOwnedSets(db: D1Database, userId: string): Promise<SetWithCount[]> {
	const res = await db
		.prepare(
			`SELECT s.*, (SELECT COUNT(*) FROM facts f WHERE f.set_id = s.id) AS fact_count
			 FROM sets s
			 WHERE s.owner_user_id = ?1
			 ORDER BY s.updated_at DESC`
		)
		.bind(userId)
		.all<SetWithCount>();
	return res.results;
}

/**
 * The published gallery.
 *
 * Empty sets are excluded: a published set with no facts is a broken link for
 * whoever clicks it, and the gallery is the one surface a stranger browses.
 */
export async function listPublishedSets(
	db: D1Database,
	limit: number,
	offset: number
): Promise<SetWithCount[]> {
	const res = await db
		.prepare(
			`SELECT s.*, (SELECT COUNT(*) FROM facts f WHERE f.set_id = s.id) AS fact_count
			 FROM sets s
			 WHERE s.published_at IS NOT NULL
			   AND (SELECT COUNT(*) FROM facts f WHERE f.set_id = s.id) > 0
			 ORDER BY s.published_at DESC
			 LIMIT ?1 OFFSET ?2`
		)
		.bind(limit, offset)
		.all<SetWithCount>();
	return res.results;
}

/**
 * Every global rating row belonging to a set.
 *
 * Joined through `facts` rather than stored with a `set_id` of its own: a
 * rating belongs to a QUESTION, and the question's set is a fact of the fact.
 * Duplicating it here would be a second answer to which set a rating is in,
 * free to disagree the moment anything moves.
 */
export async function loadGlobalRatings(db: D1Database, setId: string): Promise<RatingRow[]> {
	const res = await db
		.prepare(
			`SELECT r.* FROM variant_ratings r
			 JOIN facts f ON f.id = r.fact_id
			 WHERE f.set_id = ?1`
		)
		.bind(setId)
		.all<RatingRow>();
	return res.results;
}

/** The same, for one reader. */
export async function loadUserRatings(
	db: D1Database,
	setId: string,
	userId: string
): Promise<RatingRow[]> {
	const res = await db
		.prepare(
			`SELECT r.* FROM user_variant_ratings r
			 JOIN facts f ON f.id = r.fact_id
			 WHERE f.set_id = ?1 AND r.user_id = ?2`
		)
		.bind(setId, userId)
		.all<RatingRow>();
	return res.results;
}

export async function loadProgress(
	db: D1Database,
	setId: string,
	userId: string
): Promise<ProgressRow | null> {
	const row = await db
		.prepare(`SELECT * FROM set_progress WHERE user_id = ?1 AND set_id = ?2`)
		.bind(userId, setId)
		.first<ProgressRow>();
	return row ?? null;
}
