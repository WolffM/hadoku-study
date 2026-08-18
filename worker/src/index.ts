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

	app.doc(
		'/study/api/openapi.json',
		createOpenAPIDocConfig({
			title: 'Study API',
			version: '1.0.0',
			description: `
Flashcard sets you create and drill.

## Visibility
A set is owned by a user and private by default. Publishing is a per-set flag —
not a second copy — after which anyone, including signed-out readers, may read
and study it. A private set is reported as ABSENT to anyone but its owner, so
probing ids reveals nothing.

## Authentication
- **Read a published set**: public, no account.
- **Create or modify a set**: friend tier or above, and the row binds to the
  registry userId that edge-router injects as X-User-Id.
- **Progress**: gated on identity rather than tier — it is private data about a
  set the caller can already read. Signed-out readers keep progress on-device.
			`,
			production: 'https://hadoku.me/study/api',
			tags: [
				{ name: 'Health', description: 'Health check endpoints' },
				{ name: 'Sets', description: 'Flashcard set CRUD and publishing' },
				{ name: 'Cards', description: 'The cards inside a set' },
				{ name: 'Progress', description: 'Where a reader left off in a set' },
			],
		})
	);

	// --------------------------------------------------------------------------
	// Error Handlers
	// --------------------------------------------------------------------------

	const { notFoundHandler, errorHandler } = createErrorHandlers('wrapped');
	app.notFound(notFoundHandler);
	app.onError(errorHandler);

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

export type { AppEnv, CardRow, ProgressRow, SetRow } from './types.js';
export * from './schemas.js';
