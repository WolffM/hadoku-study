/**
 * A reader's own study data, kept in prefs-api.
 *
 * A record that belongs to one person lives in prefs-api, never on an app's own
 * disk (hadoku_site IDENTITY_MODEL R12), so deleting their account erases it in
 * one place. Here that is a reader's resume bookmark, their rating of each
 * question, and their answer ledger: prefs-api ITEMS (many small keyed values
 * per person), because a set's worth of ratings and answers does not fit one
 * 32 KB prefs row and is read and written a question at a time.
 *
 * The worker reaches prefs-api through the edge (the EDGE service binding) with
 * the reader's own key, which the edge forwarded on their request: it reads and
 * writes their items AS them. The one thing done across readers, sweeping a
 * deleted set or a removed fact from everyone, uses the worker's service key on
 * prefs-api's `_service/study` surface (edge allow list `prefs-study`).
 *
 * Keys, all under the set so one prefix reaches a set's worth:
 *   set:<setId>:progress
 *   set:<setId>:rating:<factId>:<variant>     variant base64url (it holds <>,)
 *   set:<setId>:attempt:<attemptId>           attemptId base64url (client-minted)
 */
import { tierAtLeast, type HadokuAuthContext } from '@wolffm/worker-utils';
import type { Context } from 'hono';
import type { RatingState } from './rating.js';
import type { AppEnv } from './types.js';

export type { RatingState };

const PREFS = 'https://hadoku.me/prefs/api/v1';
const APP = 'study';

/** Who a personal request is for: the edge-stamped userId and the key the edge forwarded. */
export interface Person {
	userId: string;
	key: string;
}

/**
 * The reader behind a request, or null: signed out, or below friend.
 *
 * Friend and up only, decided by the edge-verified tier (`tierAtLeast`), never
 * by an identity merely being present. Since 2026-11-10 the edge stamps a
 * MEMBER's identity on every route, and a member is a stranger who signed
 * themselves up: their key is internal, so sending it on to prefs-api is a 401
 * that turned every progress and rating route into an error for them. Below
 * friend a reader is anonymous here, exactly as before members existed, and
 * gets the anonymous answers (no progress, "stays on this device").
 */
export function personOf(c: Context): Person | null {
	const auth = c.get('authContext') as HadokuAuthContext | undefined;
	if (!tierAtLeast(auth, 'friend')) return null;
	const userId = c.req.header('X-User-Id')?.trim();
	const key = c.req.header('X-User-Key')?.trim();
	return userId && key ? { userId, key } : null;
}

export interface Progress {
	queue: string[];
	results: Record<string, 'got' | 'missed'>;
	updatedAt: number;
}

export interface AttemptRecord {
	factId: string;
	variantKey: string;
	game: string;
	result: string;
	response: string | null;
	ratingBefore: number;
	ratingAfter: number;
	createdAt: number;
}

interface Item<T> {
	key: string;
	value: T;
	version: number;
}

export function b64url(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): string {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

export const keys = {
	set: (setId: string) => `set:${setId}:`,
	progress: (setId: string) => `set:${setId}:progress`,
	ratings: (setId: string) => `set:${setId}:rating:`,
	factRatings: (setId: string, factId: string) => `set:${setId}:rating:${factId}:`,
	rating: (setId: string, factId: string, variantKey: string) =>
		`set:${setId}:rating:${factId}:${b64url(variantKey)}`,
	attempt: (setId: string, attemptId: string) => `set:${setId}:attempt:${b64url(attemptId)}`,
};

export class PrefsUnavailable extends Error {
	constructor(
		readonly status: number,
		what: string
	) {
		super(`prefs-api ${what} answered ${status}`);
		this.name = 'PrefsUnavailable';
	}
}

function edgeFetch(env: AppEnv, url: string, init: RequestInit): Promise<Response> {
	if (!env.EDGE) throw new PrefsUnavailable(503, 'EDGE binding');
	return env.EDGE.fetch(new Request(url, init));
}

function asPerson(person: Person): Record<string, string> {
	return { 'Content-Type': 'application/json', 'X-User-Key': person.key };
}

const itemUrl = (key: string) => `${PREFS}/${APP}/items/${encodeURIComponent(key)}`;

export async function getItem<T>(
	env: AppEnv,
	person: Person,
	key: string
): Promise<Item<T> | null> {
	const res = await edgeFetch(env, itemUrl(key), { headers: asPerson(person) });
	if (res.status === 404) return null;
	if (!res.ok) throw new PrefsUnavailable(res.status, `GET ${key}`);
	return await res.json<Item<T>>();
}

export async function listItems<T>(
	env: AppEnv,
	person: Person,
	prefix: string
): Promise<Item<T>[]> {
	const out: Item<T>[] = [];
	let after: string | null = null;
	do {
		const q = new URLSearchParams({ prefix, limit: '500', ...(after ? { after } : {}) });
		const res = await edgeFetch(env, `${PREFS}/${APP}/items?${q.toString()}`, {
			headers: asPerson(person),
		});
		if (!res.ok) throw new PrefsUnavailable(res.status, `list ${prefix}`);
		const page = await res.json<{ items: Item<T>[]; next: string | null }>();
		out.push(...page.items);
		after = page.next;
	} while (after);
	return out;
}

/** Put one item. `expectedVersion: 0` is create-only: false when it already exists. */
export async function putItem(
	env: AppEnv,
	person: Person,
	key: string,
	value: unknown,
	expectedVersion?: number
): Promise<boolean> {
	const res = await edgeFetch(env, itemUrl(key), {
		method: 'PUT',
		headers: asPerson(person),
		body: JSON.stringify({ value, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }),
	});
	if (res.status === 409) return false;
	if (!res.ok) throw new PrefsUnavailable(res.status, `PUT ${key}`);
	return true;
}

export async function deleteItem(env: AppEnv, person: Person, key: string): Promise<void> {
	const res = await edgeFetch(env, itemUrl(key), { method: 'DELETE', headers: asPerson(person) });
	if (!res.ok) throw new PrefsUnavailable(res.status, `DELETE ${key}`);
}

/**
 * Delete EVERY reader's items under a prefix: a deleted set (`keys.set`), a
 * removed fact's ratings (`keys.factRatings`). The worker's own service key, on
 * prefs-api's `_service/study` surface.
 */
export async function sweepAcrossReaders(env: AppEnv, prefix: string): Promise<number> {
	if (!env.HADOKU_SERVICE_KEY) throw new PrefsUnavailable(503, 'sweep (no HADOKU_SERVICE_KEY)');
	const res = await edgeFetch(env, `${PREFS}/_service/${APP}/items/${APP}/delete-across`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-User-Key': env.HADOKU_SERVICE_KEY },
		body: JSON.stringify({ prefix }),
	});
	if (!res.ok) throw new PrefsUnavailable(res.status, `sweep ${prefix}`);
	return (await res.json<{ deleted: number }>()).deleted;
}

/** This reader's ratings in one set, by `factId:variantKey`. */
export async function readerRatings(
	env: AppEnv,
	person: Person,
	setId: string
): Promise<Map<string, { key: string; state: RatingState }>> {
	const prefix = keys.ratings(setId);
	const out = new Map<string, { key: string; state: RatingState }>();
	for (const item of await listItems<RatingState>(env, person, prefix)) {
		const rest = item.key.slice(prefix.length);
		const cut = rest.indexOf(':');
		if (cut < 0) continue;
		const factId = rest.slice(0, cut);
		const variantKey = fromB64url(rest.slice(cut + 1));
		out.set(`${factId}:${variantKey}`, { key: item.key, state: item.value });
	}
	return out;
}
