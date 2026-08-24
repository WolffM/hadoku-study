/**
 * The OpenAPI document is a contract, so it gets asserted like one.
 *
 * Both defects these tests cover shipped to production and went unnoticed for
 * months, because a wrong spec breaks nobody's build — it breaks the next
 * caller who trusts it. Every check here is a bug that was live on
 * 2026-08-19.
 */

import { describe, expect, it } from 'vitest';
import { createOpenAPIDocument } from './index.js';

const doc = createOpenAPIDocument();

/** Operations a signed-out caller is meant to reach. */
const PUBLIC_OPS = new Set([
	'get /study/api/health',
	'get /study/api/sets/published',
	// Published sets are readable with no account — that is the entire point of
	// publishing, and a spec that failed to say so would push every client into
	// demanding a key first.
	'get /study/api/sets/{id}',
]);

describe('server URLs', () => {
	it('carry the origin only, so they do not repeat the path prefix', () => {
		// servers[].url + paths[] is concatenated by every generated client. Both
		// halves once contained /study/api, which made every request 404.
		for (const server of doc.servers) {
			const path = new URL(server.url).pathname;
			expect(path, `${server.url} must not carry a base path`).toBe('/');
		}
	});

	it('join with a path to form the URL the worker actually answers', () => {
		const production = doc.servers.find((s) => s.url.startsWith('https://'));
		expect(`${production?.url}/study/api/sets/published`).toBe(
			'https://hadoku.me/study/api/sets/published'
		);
	});
});

describe('security', () => {
	it('declares the header schemes a caller has to supply', () => {
		const schemes = doc.components.securitySchemes ?? {};
		expect(Object.keys(schemes).sort()).toEqual(['SessionId', 'UserKey']);
		expect(schemes.UserKey?.name).toBe('X-User-Key');
		expect(schemes.SessionId?.name).toBe('X-Session-Id');
	});

	it('marks every operation, so none is left silently unauthenticated', () => {
		for (const [path, methods] of Object.entries(doc.paths)) {
			for (const [method, op] of Object.entries(methods)) {
				expect(op.security, `${method.toUpperCase()} ${path}`).toBeDefined();
			}
		}
	});

	it('lets a signed-out caller read published sets, and nothing else', () => {
		for (const [path, methods] of Object.entries(doc.paths)) {
			for (const [method, op] of Object.entries(methods)) {
				const key = `${method} ${path}`;
				// An empty requirement object is OpenAPI for "no credentials needed".
				const anonymous = (op.security ?? []).some((req) => Object.keys(req).length === 0);
				// Progress is identity-gated but reachable signed-out (it 403s with a
				// reason rather than being unreachable), so it is exempt from neither
				// list — assert only the operations whose visibility is a policy call.
				if (PUBLIC_OPS.has(key)) expect(anonymous, `${key} must stay public`).toBe(true);
				if (method === 'post' || method === 'delete' || method === 'patch') {
					expect(anonymous, `${key} must require credentials`).toBe(false);
				}
			}
		}
	});
});

describe('the routes agents need', () => {
	it('exposes a whole-set PUT alongside the whole-set GET', () => {
		expect(Object.keys(doc.paths['/study/api/sets/{id}'] ?? {}).sort()).toEqual([
			'delete',
			'get',
			'patch',
			'put',
		]);
	});

	it('exposes the ratings pair, so a mount regression cannot ship silently', () => {
		// Both were mounted in one line in index.ts. Forgetting that line leaves
		// every test above green — they iterate whatever paths exist — and the
		// only symptom in production is a 404 the client swallows.
		expect(Object.keys(doc.paths['/study/api/sets/{id}/ratings'] ?? {})).toEqual(['get']);
		expect(Object.keys(doc.paths['/study/api/sets/{id}/attempts'] ?? {})).toEqual(['post']);
	});

	it('publishes the rating shape, not just the routes', () => {
		// An agent reading the spec has to be able to see what `global` and
		// `local` mean without reading this repo.
		expect(doc.components?.schemas?.Rating).toBeDefined();
		expect(doc.components?.schemas?.AttemptInput).toBeDefined();
	});
});
