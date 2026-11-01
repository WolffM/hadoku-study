/**
 * A reader's own study data in prefs-api (person.ts), and the move of their
 * old D1 rows into it (legacy.ts). prefs-api is an in-memory fake of its item
 * routes, reached through the EDGE binding the way the worker reaches it; D1 is
 * real SQLite.
 */
import { describe, expect, it } from 'vitest';
import {
	b64url,
	fromB64url,
	getItem,
	keys,
	putItem,
	readerRatings,
	sweepAcrossReaders,
	type Person,
} from './person.js';
import type { AppEnv } from './types.js';

const ALICE: Person = { userId: 'u-alice', key: 'alice-key' };
const BOB: Person = { userId: 'u-bob', key: 'bob-key' };
const SERVICE_KEY = 'study-service-key';

/** prefs-api's item routes, as the edge would answer them for a person's key. */
function fakePrefs(opts: { failPuts?: boolean } = {}) {
	const owners: Record<string, string> = { 'alice-key': ALICE.userId, 'bob-key': BOB.userId };
	const store = new Map<string, { value: unknown; version: number }>(); // `${userId}|${key}`
	const calls: { method: string; path: string; key: string | null }[] = [];
	const fetcher = {
		async fetch(req: Request): Promise<Response> {
			const url = new URL(req.url);
			const userKey = req.headers.get('X-User-Key');
			calls.push({ method: req.method, path: url.pathname, key: userKey });
			const json = (b: unknown, status = 200) => Response.json(b, { status });
			if (url.pathname === '/prefs/api/v1/_service/study/items/study/delete-across') {
				if (userKey !== SERVICE_KEY) return json({ error: 'Forbidden' }, 403);
				const { prefix } = (await req.json()) as { prefix: string };
				let deleted = 0;
				for (const k of [...store.keys()]) {
					if (k.split('|')[1].startsWith(prefix)) {
						store.delete(k);
						deleted++;
					}
				}
				return json({ deleted });
			}
			const who = userKey ? owners[userKey] : undefined;
			if (!who) return json({ error: 'Unauthorized' }, 401);
			const base = '/prefs/api/v1/study/items';
			if (url.pathname === base) {
				const prefix = url.searchParams.get('prefix') ?? '';
				const items = [...store]
					.filter(([k]) => k.startsWith(`${who}|${prefix}`))
					.map(([k, v]) => ({ key: k.split('|')[1], ...v, updatedAt: 1 }))
					.sort((a, b) => a.key.localeCompare(b.key));
				return json({ items, next: null });
			}
			const key = decodeURIComponent(url.pathname.slice(base.length + 1));
			const id = `${who}|${key}`;
			if (req.method === 'GET') {
				const v = store.get(id);
				return v ? json({ key, ...v, updatedAt: 1 }) : json({ error: 'Not Found' }, 404);
			}
			if (req.method === 'DELETE') return json({ deleted: store.delete(id) });
			if (opts.failPuts) return json({ error: 'down' }, 503);
			const body = (await req.json()) as { value: unknown; expectedVersion?: number };
			const cur = store.get(id);
			if (body.expectedVersion === 0 && cur) return json({ error: 'Conflict', current: cur }, 409);
			const next = { value: body.value, version: (cur?.version ?? 0) + 1 };
			store.set(id, next);
			return json({ key, ...next, updatedAt: 1 });
		},
	};
	return { store, calls, fetcher };
}

const envWith = (fetcher: { fetch(req: Request): Promise<Response> }, db?: D1Database): AppEnv =>
	({ EDGE: fetcher, HADOKU_SERVICE_KEY: SERVICE_KEY, STUDY_DB: db }) as unknown as AppEnv;

describe('person.ts', () => {
	it('round-trips a variant key that holds <>, through its item key', async () => {
		expect(fromB64url(b64url('when<what,where,who>'))).toBe('when<what,where,who>');
		const { fetcher } = fakePrefs();
		const env = envWith(fetcher);
		const state = { rating: 1510, plays: 3, run: 1, runResult: 'got' };
		await putItem(env, ALICE, keys.rating('s1', 'f1', 'when<what,where,who>'), state);
		await putItem(env, ALICE, keys.rating('s2', 'f9', 'x'), state);
		const mine = await readerRatings(env, ALICE, 's1');
		expect([...mine.keys()]).toEqual(['f1:when<what,where,who>']);
		expect(mine.get('f1:when<what,where,who>')?.state).toEqual(state);
		expect((await readerRatings(env, BOB, 's1')).size).toBe(0);
	});

	it('writes an answer once: create-only says false the second time', async () => {
		const { fetcher } = fakePrefs();
		const env = envWith(fetcher);
		expect(await putItem(env, ALICE, keys.attempt('s1', 'a-1'), { result: 'got' }, 0)).toBe(true);
		expect(await putItem(env, ALICE, keys.attempt('s1', 'a-1'), { result: 'got' }, 0)).toBe(false);
	});

	it("sweeps every reader's items for a set with the service key, and refuses without one", async () => {
		const { fetcher, calls } = fakePrefs();
		const env = envWith(fetcher);
		for (const p of [ALICE, BOB]) {
			await putItem(env, p, keys.progress('s1'), { queue: [] });
			await putItem(env, p, keys.progress('s10'), { queue: [] });
		}
		expect(await sweepAcrossReaders(env, keys.set('s1'))).toBe(2);
		expect(calls.at(-1)?.key).toBe(SERVICE_KEY);
		expect(await getItem(env, ALICE, keys.progress('s10'))).not.toBeNull();
		const noKey = { ...env, HADOKU_SERVICE_KEY: undefined } as AppEnv;
		await expect(sweepAcrossReaders(noKey, keys.set('s1'))).rejects.toThrow(/HADOKU_SERVICE_KEY/);
	});
});
