/**
 * Where you left off in a set.
 *
 * This is a resume bookmark for ONE pass, not a scheduling record. v1 is a
 * plain drill — walk the set, self-grade, done — so there is no ease factor,
 * no interval and no due date here. The row exists so a lock screen, a rotate,
 * or coming back an hour later does not cost you your place, and it is deleted
 * the moment the pass completes.
 *
 * Gated on IDENTITY, not on tier. Progress is private data about a set the
 * caller can already read, so the question is only "who is this", never "are
 * they friend+". A signed-out reader has no identity and therefore no server
 * bookmark — the client keeps theirs in localStorage instead, which is the
 * only place it could live.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { notFoundWrapped, okWrapped, type HadokuAuthContext } from '@wolffm/worker-utils';
import { loadProgress, loadSetForRead } from '../db.js';
import { readerUserId } from '../auth.js';
import {
	DeleteResponseSchema,
	ErrorResponseSchema,
	ProgressResponseSchema,
	PutProgressInputSchema,
} from '../schemas.js';
import type { AppEnv } from '../types.js';

interface RouteContext {
	Bindings: AppEnv;
	Variables: { authContext: HadokuAuthContext };
}

const app = new OpenAPIHono<RouteContext>();

const params = z.object({ id: z.string() });

// ============================================================================
// GET /sets/:id/progress
// ============================================================================

const getProgressRoute = createRoute({
	method: 'get',
	path: '/sets/{id}/progress',
	tags: ['Progress'],
	summary: 'Your saved place in a set',
	description:
		'Null when there is nothing saved, and null for a signed-out caller — who has no server-side progress by definition, and is not an error.',
	request: { params },
	responses: {
		200: {
			description: 'Saved progress, or null',
			content: { 'application/json': { schema: ProgressResponseSchema } },
		},
		404: {
			description: 'No such set — or it is private and not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(getProgressRoute, async (c) => {
	const { id } = c.req.valid('param');
	const userId = readerUserId(c);
	const db = c.env.STUDY_DB;

	// Resolve the set FIRST, so a set the caller cannot read 404s here exactly
	// as it does everywhere else — rather than answering "no progress" and
	// confirming the id exists.
	const set = await loadSetForRead(db, id, userId);
	if (!set) return notFoundWrapped(c, 'Set');

	if (!userId) return okWrapped(c, { progress: null });

	const row = await loadProgress(db, id, userId);
	if (!row) return okWrapped(c, { progress: null });

	return okWrapped(c, {
		progress: {
			queue: JSON.parse(row.queue) as string[],
			results: JSON.parse(row.results) as Record<string, 'got' | 'missed'>,
			updatedAt: new Date(row.updated_at).toISOString(),
		},
	});
});

// ============================================================================
// PUT /sets/:id/progress
// ============================================================================

const putProgressRoute = createRoute({
	method: 'put',
	path: '/sets/{id}/progress',
	tags: ['Progress'],
	summary: 'Save your place in a set',
	description:
		'Upserts the caller’s bookmark. The client batches these — a write per graded card would be one round trip per flip, which is exactly the latency the drill loop is built to avoid.',
	request: {
		params,
		body: { content: { 'application/json': { schema: PutProgressInputSchema } }, required: true },
	},
	responses: {
		200: {
			description: 'Saved',
			content: { 'application/json': { schema: ProgressResponseSchema } },
		},
		403: {
			description: 'Signed out — no identity to save progress against',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description: 'No such set — or it is private and not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(putProgressRoute, async (c) => {
	const { id } = c.req.valid('param');
	const body = c.req.valid('json');
	const userId = readerUserId(c);
	const db = c.env.STUDY_DB;

	const set = await loadSetForRead(db, id, userId);
	if (!set) return notFoundWrapped(c, 'Set');

	if (!userId) {
		return c.json(
			{
				success: false,
				error: 'Forbidden',
				message:
					'Saving progress needs a signed-in identity. Signed-out progress stays on the device.',
			},
			403
		);
	}

	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO set_progress (user_id, set_id, queue, results, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5)
			 ON CONFLICT (user_id, set_id)
			 DO UPDATE SET queue = excluded.queue, results = excluded.results, updated_at = excluded.updated_at`
		)
		.bind(userId, id, JSON.stringify(body.queue), JSON.stringify(body.results), now)
		.run();

	return okWrapped(c, {
		progress: { queue: body.queue, results: body.results, updatedAt: new Date(now).toISOString() },
	});
});

// ============================================================================
// DELETE /sets/:id/progress — finishing a pass, or starting over
// ============================================================================

const deleteProgressRoute = createRoute({
	method: 'delete',
	path: '/sets/{id}/progress',
	tags: ['Progress'],
	summary: 'Clear your saved place',
	description: 'Called when a pass completes, and when the reader restarts a set from the top.',
	request: { params },
	responses: {
		200: {
			description: 'Cleared',
			content: { 'application/json': { schema: DeleteResponseSchema } },
		},
		403: {
			description: 'Signed out — nothing server-side to clear',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(deleteProgressRoute, async (c) => {
	const { id } = c.req.valid('param');
	const userId = readerUserId(c);

	if (!userId) {
		return c.json(
			{
				success: false,
				error: 'Forbidden',
				message:
					'Saving progress needs a signed-in identity. Signed-out progress stays on the device.',
			},
			403
		);
	}

	// No set lookup: this deletes only the caller's OWN row, so it can neither
	// touch anyone else's data nor reveal whether the id exists.
	await c.env.STUDY_DB.prepare(`DELETE FROM set_progress WHERE user_id = ?1 AND set_id = ?2`)
		.bind(userId, id)
		.run();

	return okWrapped(c, { setId: id });
});

export const progressRoutes = app;
