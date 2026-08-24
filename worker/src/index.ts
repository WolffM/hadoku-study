/**
 * Study Worker Package
 *
 * Exports factory functions for Cloudflare Workers.
 * The host worker in hadoku_site imports these and delegates to them.
 *
 * @example
 * ```typescript
 * // In hadoku_site/workers/study-api/src/index.ts
 * import { createFetchHandler, type AppEnv } from '@wolffm/study-worker';
 *
 * export default {
 *   async fetch(request: Request, env: AppEnv): Promise<Response> {
 *     return createFetchHandler(env)(request);
 *   },
 * };
 * ```
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import {
	createEdgeAuth,
	wrappedValidationHook,
	createErrorHandlers,
	createOpenAPIDocConfig,
	DEFAULT_HADOKU_ORIGINS,
	type HadokuAuthContext,
} from '@wolffm/worker-utils';
import { SECURITY_SCHEMES } from './security.js';
import { logUnhandled } from './telemetry.js';
import type { AppEnv } from './types.js';
import { healthRoutes } from './routes/health.js';
import { setRoutes } from './routes/sets.js';
import { progressRoutes } from './routes/progress.js';

interface AppContext {
	Bindings: AppEnv;
	Variables: {
		authContext: HadokuAuthContext;
	};
}

/**
 * The static half of the OpenAPI document.
 *
 * Hoisted out of `createApp` so `index.spec.ts` can generate and assert on the
 * finished spec. The spec is the contract agents read before their first
 * request, and it has shipped broken before — an unasserted contract is one
 * nobody notices breaking.
 */
const openApiDocConfig = createOpenAPIDocConfig({
	title: 'Study API',
	version: '1.0.0',
	description: `
Study sets you create, drill and play.

## Visibility
A set is owned by a user and private by default. Publishing is a per-set flag —
not a second copy — after which anyone, including signed-out readers, may read
and study it. A private set is reported as ABSENT to anyone but its owner, so
probing ids reveals nothing.

## Authentication
Send \`X-User-Key: <your hadoku key>\` (scripts and agents) or \`X-Session-Id\`
(browsers, which normally use the session cookie instead). edge-router resolves
either to a registry user and re-stamps the request; sets bind to that userId,
never to the key, because a key can rotate and the userId does not.

- **Read a published set**: public, no account.
- **Create or modify a set**: friend tier or above.
- **Progress**: gated on identity rather than tier — it is private data about a
  set the caller can already read. Signed-out readers keep progress on-device.

## Facts, not cards
A set holds FACTS. A fact is a bundle of named slots — what is true — and the
API expands each one into the QUESTIONS you can ask of it:

\`\`\`json
{
  "slots": {
    "who":   "Martin Luther and Emperor Charles V",
    "what":  "Luther refused to recant his writings",
    "where": "the Diet of Worms",
    "when":  "1521"
  },
  "detail": "“Here I stand” is almost certainly a later embellishment.",
  "questions": [
    { "ask": "when",  "seedTier": 1,
      "prompt": "What year did Luther refuse to recant before Charles V?" },
    { "ask": "who",   "seedTier": 3, "given": ["what", "where", "when"] }
  ]
}
\`\`\`

- **\`ask\`** names the slot that is the ANSWER. Everything else is context.
- **\`given\`** omitted means every other slot. Naming FEWER is how one fact
  yields a harder question — and the two rate independently, because the given
  set is part of the question's identity.
- **\`prompt\`** is how the question reads. Write one. The fallback phrasings are
  deliberately plain, and a set that leans on them sounds like a form.
- **\`questions\`** omitted means "ask each slot in turn, giving all the others".
- **\`seedTier\`** (1–5) only SEEDS difficulty. It is not a score, and play moves
  it from there.

\`who\` / \`what\` / \`where\` / \`when\` / \`why\` / \`how\` / \`quote\` / \`term\` /
\`definition\` are phrased automatically when no prompt is written; \`why\`, \`how\`
and \`definition\` are treated as answers you explain rather than name. Any other
slot name works and simply needs a \`prompt\`.

Responses carry a \`variants\` array per fact, each with a stable \`key\`. Those
keys are derived here and only here, so read them rather than building them.

## A set is a single file
\`GET /sets/{id}\` returns the whole set, facts included, and unknown fields are
stripped on the way back in — so the exported object is a valid import body
with no editing. The round trip is three commands:

\`\`\`bash
# export
curl -sH "X-User-Key: $KEY" https://hadoku.me/study/api/sets/$ID \\
  | jq .data.set > set.json

# import as a NEW set (add '"published": true' to share it on create)
curl -sH "X-User-Key: $KEY" -H 'Content-Type: application/json' \\
  --json @set.json https://hadoku.me/study/api/sets

# write an edited file back over the SAME set — metadata and facts, one call
curl -sX PUT -H "X-User-Key: $KEY" -H 'Content-Type: application/json' \\
  --json @set.json https://hadoku.me/study/api/sets/$ID
\`\`\`

Only \`title\` and \`facts\` are required; \`description\` and \`published\` are
optional. On PUT, an omitted \`published\` leaves visibility ALONE — a file
describes a set's content, so one that never mentions publication must not be
able to silently unshare it.

**Send each fact back with the \`id\` it was exported with.** An id that already
belongs to the set is kept, and every rating and attempt hanging off it
survives the save; anything else is minted fresh. Dropping the ids is how you
silently discard a set's play history.
		`,
	// The origin ONLY. Every path in this document already carries the
	// /study/api prefix the worker mounts on, so a server URL that
	// repeats it makes every generated client request
	// /study/api/study/api/... — which 404s. The spec shipped that way
	// until 2026-08-19.
	production: 'https://hadoku.me',
	tags: [
		{ name: 'Health', description: 'Health check endpoints' },
		{ name: 'Sets', description: 'Set CRUD and publishing' },
		{ name: 'Progress', description: 'Where a reader left off in a set' },
	],
});

function createApp() {
	const app = new OpenAPIHono<AppContext>({
		defaultHook: wrappedValidationHook,
	});

	// --------------------------------------------------------------------------
	// Middleware Stack
	// --------------------------------------------------------------------------

	app.use(
		'*',
		cors({
			origin: DEFAULT_HADOKU_ORIGINS,
			allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'X-User-Key', 'X-API-Key', 'X-Session-Id'],
			credentials: true,
			maxAge: 86400,
		})
	);

	// Resolves the edge-stamped tier onto `authContext`. It never refuses a
	// request — routes gate themselves, because this API's paths are public to
	// read and friend+ to write on the SAME path (see routes/sets.ts).
	app.use('*', createEdgeAuth());

	// --------------------------------------------------------------------------
	// Route Registration
	// --------------------------------------------------------------------------
	// EVERYTHING mounts under /study/api — the browser-facing path.
	// edge-router forwards hadoku.me/study/api/* to this worker UNCHANGED
	// (no stripPrefix), so a worker that mounts anywhere else 404s on every
	// request that comes through the edge. Health lives there too:
	// hadoku.me/study/api/health.

	app.route('/study/api', healthRoutes);
	app.route('/study/api', setRoutes);
	app.route('/study/api', progressRoutes);

	// --------------------------------------------------------------------------
	// OpenAPI Spec Endpoint
	// --------------------------------------------------------------------------
	// Security schemes go through the REGISTRY, not the doc config: the
	// generator builds `components` from the registry and spreads it OVER the
	// config it is handed, so a `components` key passed to app.doc() below is
	// silently discarded along with every schema zod contributed.

	for (const [name, scheme] of Object.entries(SECURITY_SCHEMES)) {
		app.openAPIRegistry.registerComponent('securitySchemes', name, scheme);
	}

	app.doc('/study/api/openapi.json', openApiDocConfig);

	// --------------------------------------------------------------------------
	// Error Handlers
	// --------------------------------------------------------------------------

	const { notFoundHandler, errorHandler } = createErrorHandlers('wrapped');
	app.notFound(notFoundHandler);

	// Log the cause BEFORE delegating. The shared handler console.errors the raw
	// error, which Cloudflare captures, but as an unstructured line outside the
	// logger — so it never reaches the platform pipeline and cannot be queried
	// next to the request row it belongs to. The caller still gets the same
	// deliberately vague 500; the detail is for us, not for them.
	//
	// This is the gap that made a D1 parameter-limit bug cost a bisection
	// against production on 2026-08-21: the response said "an unexpected error
	// occurred" and the underlying error, which names the problem outright, was
	// nowhere a query could reach.
	app.onError((err, c) => {
		logUnhandled(c.req.method, c.req.path, err);
		return errorHandler(err, c);
	});

	return app;
}

/**
 * Create the fetch handler for HTTP requests.
 *
 * @param env - Worker environment bindings
 * @returns Request handler function
 */
export function createFetchHandler(env: AppEnv) {
	const app = createApp();
	return (request: Request) => app.fetch(request, env);
}

/** One operation, as a reader of the finished document sees it. */
export interface OpenAPIOperation {
	summary?: string;
	/** A LIST of requirement objects, which OpenAPI reads as OR. An entry with
	 *  no keys means the operation is reachable with no credentials. */
	security?: Record<string, string[]>[];
}

/**
 * The finished document, described structurally.
 *
 * Deliberately not `OpenAPIObject`: that type lives in `openapi3-ts`, which
 * reaches this package only transitively, so naming it puts an import in the
 * published .d.ts that consumers cannot resolve. This covers what a reader of
 * a spec actually reaches for.
 */
export interface OpenAPIDocument {
	openapi: string;
	info: { title: string; version: string; description?: string };
	servers: { url: string; description?: string }[];
	paths: Record<string, Record<string, OpenAPIOperation>>;
	components: {
		securitySchemes?: Record<string, { type: string; in?: string; name?: string }>;
	};
}

/**
 * The finished OpenAPI document — byte-for-byte what `/study/api/openapi.json`
 * serves.
 *
 * Exported so the spec can be asserted on in tests and generated into a client
 * without standing up a worker or reaching the network.
 */
export function createOpenAPIDocument(): OpenAPIDocument {
	return createApp().getOpenAPIDocument(openApiDocConfig) as unknown as OpenAPIDocument;
}

export type { AppEnv, FactRow, ProgressRow, SetRow } from './types.js';
export * from './schemas.js';
