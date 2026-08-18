/**
 * Set + card CRUD.
 *
 * Method-level gating, not path-level. `/sets/:id` is public to READ when the
 * set is published and friend+-and-owner to MODIFY — one path, two policies —
 * so the tier check lives in each handler rather than in a `requireMinTier`
 * mounted on the path. Mounting it on the path would have made reading a
 * shared set require an account, which is the one thing publishing exists to
 * avoid.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
	badRequestWrapped,
	createdWrapped,
	notFoundWrapped,
	okWrapped,
	type HadokuAuthContext,
} from '@wolffm/worker-utils';
import {
	MAX_CARDS_PER_SET,
	listCards,
	listOwnedSets,
	listPublishedSets,
	loadSetForRead,
	loadSetForWrite,
	newId,
	type SetWithCount,
} from '../db.js';
import { readerUserId, resolveWriter } from '../auth.js';
import {
	CardsResponseSchema,
	CreateSetInputSchema,
	DeleteResponseSchema,
	ErrorResponseSchema,
	ReplaceCardsInputSchema,
	SetDetailResponseSchema,
	SetResponseSchema,
	SetsResponseSchema,
	UpdateSetInputSchema,
	type CardInput,
} from '../schemas.js';
import type { AppEnv, CardRow, SetRow } from '../types.js';

interface RouteContext {
	Bindings: AppEnv;
	Variables: { authContext: HadokuAuthContext };
}

const app = new OpenAPIHono<RouteContext>();

const iso = (ms: number) => new Date(ms).toISOString();

function toSetJson(row: SetRow, cardCount: number, viewerId: string | null) {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		published: row.published_at !== null,
		cardCount,
		isOwner: viewerId !== null && row.owner_user_id === viewerId,
		createdAt: iso(row.created_at),
		updatedAt: iso(row.updated_at),
	};
}

const toCardJson = (row: CardRow) => ({ id: row.id, front: row.front, back: row.back });

const listJson = (rows: SetWithCount[], viewerId: string | null) =>
	rows.map((row) => toSetJson(row, row.card_count, viewerId));

/**
 * Rows per INSERT.
 *
 * Each row binds 5 parameters, so 50 rows is 250 — comfortably inside SQLite's
 * 999-variable ceiling, and it turns a full 500-card set into 12 statements
 * rather than 502. One statement per card would put the batch's size in the
 * hands of whoever pasted the deck.
 */
const INSERT_CHUNK = 50;

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Replace a set's cards and stamp the set as updated, as ONE batch.
 *
 * D1 runs a batch in an implicit transaction, so a failed insert cannot leave
 * the set holding a partial deck — which a delete-then-insert pair of separate
 * statements absolutely could, and the failure would be silent data loss on
 * someone's set.
 */
function replaceCardsBatch(db: D1Database, setId: string, cards: CardInput[], now: number) {
	const inserts = chunk(cards, INSERT_CHUNK).map((group, groupIndex) => {
		const values = group.map((_, i) => {
			const p = i * 5;
			return `(?${p + 1}, ?${p + 2}, ?${p + 3}, ?${p + 4}, ?${p + 5})`;
		});
		const bindings = group.flatMap((card, i) => [
			newId(),
			setId,
			card.front,
			card.back,
			groupIndex * INSERT_CHUNK + i,
		]);
		return db
			.prepare(`INSERT INTO cards (id, set_id, front, back, position) VALUES ${values.join(', ')}`)
			.bind(...bindings);
	});

	return db.batch([
		db.prepare(`DELETE FROM cards WHERE set_id = ?1`).bind(setId),
		...inserts,
		db.prepare(`UPDATE sets SET updated_at = ?1 WHERE id = ?2`).bind(now, setId),
	]);
}

// ============================================================================
// GET /sets — the caller's own sets
// ============================================================================

const listOwnRoute = createRoute({
	method: 'get',
	path: '/sets',
	tags: ['Sets'],
	summary: 'List your own sets',
	description: 'Every set owned by the calling user, published or not. Requires friend access.',
	responses: {
		200: {
			description: 'Your sets',
			content: { 'application/json': { schema: SetsResponseSchema } },
		},
		403: {
			description: 'Not signed in, or below friend tier',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(listOwnRoute, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const rows = await listOwnedSets(c.env.STUDY_DB, writer.userId);
	return okWrapped(c, { sets: listJson(rows, writer.userId) });
});

// ============================================================================
// GET /sets/published — the public gallery
// ============================================================================

const listPublishedRoute = createRoute({
	method: 'get',
	path: '/sets/published',
	tags: ['Sets'],
	summary: 'List published sets',
	description: 'Every published set with at least one card. Public — no account needed.',
	request: {
		query: z.object({
			limit: z.coerce.number().int().min(1).max(100).default(50),
			offset: z.coerce.number().int().min(0).default(0),
		}),
	},
	responses: {
		200: {
			description: 'Published sets',
			content: { 'application/json': { schema: SetsResponseSchema } },
		},
	},
});

app.openapi(listPublishedRoute, async (c) => {
	const { limit, offset } = c.req.valid('query');
	const rows = await listPublishedSets(c.env.STUDY_DB, limit, offset);
	return okWrapped(c, { sets: listJson(rows, readerUserId(c)) });
});

// ============================================================================
// POST /sets — create
// ============================================================================

const createRouteDef = createRoute({
	method: 'post',
	path: '/sets',
	tags: ['Sets'],
	summary: 'Create a set',
	description:
		'Creates a private set. Cards may be supplied inline so a paste-import lands in one request.',
	request: {
		body: { content: { 'application/json': { schema: CreateSetInputSchema } }, required: true },
	},
	responses: {
		201: {
			description: 'Created',
			content: { 'application/json': { schema: SetDetailResponseSchema } },
		},
		403: {
			description: 'Not signed in, or below friend tier',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(createRouteDef, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const input = c.req.valid('json');
	const db = c.env.STUDY_DB;
	const now = Date.now();
	const id = newId();

	await db
		.prepare(
			`INSERT INTO sets (id, owner_user_id, title, description, published_at, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)`
		)
		.bind(id, writer.userId, input.title, input.description ?? null, now)
		.run();

	const cards = input.cards ?? [];
	if (cards.length > 0) await replaceCardsBatch(db, id, cards, now);

	const row: SetRow = {
		id,
		owner_user_id: writer.userId,
		title: input.title,
		description: input.description ?? null,
		published_at: null,
		created_at: now,
		updated_at: now,
	};

	return createdWrapped(c, {
		set: {
			...toSetJson(row, cards.length, writer.userId),
			cards: (await listCards(db, id)).map(toCardJson),
		},
	});
});

// ============================================================================
// GET /sets/:id — detail, with every card
// ============================================================================

const getSetRoute = createRoute({
	method: 'get',
	path: '/sets/{id}',
	tags: ['Sets'],
	summary: 'Get a set and all of its cards',
	description:
		'Returns the whole set in one response so the drill loop never needs a round trip between cards. Public when the set is published; otherwise owner-only.',
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			description: 'The set',
			content: { 'application/json': { schema: SetDetailResponseSchema } },
		},
		404: {
			description: 'No such set — or it is private and not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(getSetRoute, async (c) => {
	const { id } = c.req.valid('param');
	const viewerId = readerUserId(c);
	const db = c.env.STUDY_DB;

	const row = await loadSetForRead(db, id, viewerId);
	if (!row) return notFoundWrapped(c, 'Set');

	const cards = await listCards(db, id);
	return okWrapped(c, {
		set: { ...toSetJson(row, cards.length, viewerId), cards: cards.map(toCardJson) },
	});
});

// ============================================================================
// PATCH /sets/:id — rename, re-describe, publish/unpublish
// ============================================================================

const updateSetRoute = createRoute({
	method: 'patch',
	path: '/sets/{id}',
	tags: ['Sets'],
	summary: 'Update a set',
	description:
		'Owner only. `published` is a per-set flag, not a separate copy — flipping it changes who may read the same rows.',
	request: {
		params: z.object({ id: z.string() }),
		body: { content: { 'application/json': { schema: UpdateSetInputSchema } }, required: true },
	},
	responses: {
		200: { description: 'Updated', content: { 'application/json': { schema: SetResponseSchema } } },
		403: {
			description: 'Not signed in, or below friend tier',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description: 'No such set — or not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(updateSetRoute, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const { id } = c.req.valid('param');
	const patch = c.req.valid('json');
	const db = c.env.STUDY_DB;

	const row = await loadSetForWrite(db, id, writer.userId);
	if (!row) return notFoundWrapped(c, 'Set');

	const now = Date.now();
	const title = patch.title ?? row.title;
	const description = patch.description === undefined ? row.description : patch.description;
	// Re-publishing an already-published set keeps the ORIGINAL published_at, so
	// the gallery's ordering reflects when a set was first shared rather than
	// the last time its owner toggled the switch.
	const publishedAt =
		patch.published === undefined
			? row.published_at
			: patch.published
				? (row.published_at ?? now)
				: null;

	await db
		.prepare(
			`UPDATE sets SET title = ?1, description = ?2, published_at = ?3, updated_at = ?4 WHERE id = ?5`
		)
		.bind(title, description, publishedAt, now, id)
		.run();

	const count = await db
		.prepare(`SELECT COUNT(*) AS n FROM cards WHERE set_id = ?1`)
		.bind(id)
		.first<{ n: number }>();

	return okWrapped(c, {
		set: toSetJson(
			{ ...row, title, description, published_at: publishedAt, updated_at: now },
			count?.n ?? 0,
			writer.userId
		),
	});
});

// ============================================================================
// DELETE /sets/:id
// ============================================================================

const deleteSetRoute = createRoute({
	method: 'delete',
	path: '/sets/{id}',
	tags: ['Sets'],
	summary: 'Delete a set',
	description: 'Owner only. Cards and every reader’s saved progress go with it.',
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			description: 'Deleted',
			content: { 'application/json': { schema: DeleteResponseSchema } },
		},
		403: {
			description: 'Not signed in, or below friend tier',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description: 'No such set — or not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(deleteSetRoute, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const { id } = c.req.valid('param');
	const db = c.env.STUDY_DB;

	const row = await loadSetForWrite(db, id, writer.userId);
	if (!row) return notFoundWrapped(c, 'Set');

	// Explicit, not left to ON DELETE CASCADE: D1 only enforces foreign keys
	// when the connection has them enabled, and a silently-skipped cascade
	// would strand cards and progress rows for a set that no longer exists.
	await db.batch([
		db.prepare(`DELETE FROM cards WHERE set_id = ?1`).bind(id),
		db.prepare(`DELETE FROM set_progress WHERE set_id = ?1`).bind(id),
		db.prepare(`DELETE FROM sets WHERE id = ?1`).bind(id),
	]);

	return okWrapped(c, { setId: id });
});

// ============================================================================
// PUT /sets/:id/cards — replace the whole deck
// ============================================================================

const replaceCardsRoute = createRoute({
	method: 'put',
	path: '/sets/{id}/cards',
	tags: ['Cards'],
	summary: 'Replace every card in a set',
	description:
		'Owner only. The editor holds the whole set already, so cards are written wholesale rather than patched one at a time.',
	request: {
		params: z.object({ id: z.string() }),
		body: { content: { 'application/json': { schema: ReplaceCardsInputSchema } }, required: true },
	},
	responses: {
		200: {
			description: 'Cards replaced',
			content: { 'application/json': { schema: CardsResponseSchema } },
		},
		400: {
			description: 'Too many cards',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		403: {
			description: 'Not signed in, or below friend tier',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description: 'No such set — or not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(replaceCardsRoute, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const { id } = c.req.valid('param');
	const { cards } = c.req.valid('json');
	const db = c.env.STUDY_DB;

	if (cards.length > MAX_CARDS_PER_SET) {
		return badRequestWrapped(c, `A set holds at most ${MAX_CARDS_PER_SET} cards.`);
	}

	const row = await loadSetForWrite(db, id, writer.userId);
	if (!row) return notFoundWrapped(c, 'Set');

	await replaceCardsBatch(db, id, cards, Date.now());

	return okWrapped(c, { cards: (await listCards(db, id)).map(toCardJson) });
});

export const setRoutes = app;
