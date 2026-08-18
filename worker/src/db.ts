/**
 * D1 access helpers and the visibility rules every route shares.
 */

import type { CardRow, ProgressRow, SetRow } from './types.js';

/** Cards per set. A set is meant to be prefetched whole on entry. */
export const MAX_CARDS_PER_SET = 500;
export const MAX_FIELD_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 120;
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
	card_count: number;
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

export async function listCards(db: D1Database, setId: string): Promise<CardRow[]> {
	const res = await db
		.prepare(`SELECT * FROM cards WHERE set_id = ?1 ORDER BY position ASC`)
		.bind(setId)
		.all<CardRow>();
	return res.results;
}

export async function listOwnedSets(db: D1Database, userId: string): Promise<SetWithCount[]> {
	const res = await db
		.prepare(
			`SELECT s.*, (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) AS card_count
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
 * Empty sets are excluded: a published set with no cards is a broken link for
 * whoever clicks it, and the gallery is the one surface a stranger browses.
 */
export async function listPublishedSets(
	db: D1Database,
	limit: number,
	offset: number
): Promise<SetWithCount[]> {
	const res = await db
		.prepare(
			`SELECT s.*, (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) AS card_count
			 FROM sets s
			 WHERE s.published_at IS NOT NULL
			   AND (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) > 0
			 ORDER BY s.published_at DESC
			 LIMIT ?1 OFFSET ?2`
		)
		.bind(limit, offset)
		.all<SetWithCount>();
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
