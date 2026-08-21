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
	createdWrapped,
	notFoundWrapped,
	okWrapped,
	type HadokuAuthContext,
} from '@wolffm/worker-utils';
import {
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
	ReplaceSetInputSchema,
	SetDetailResponseSchema,
	SetResponseSchema,
	SetsResponseSchema,
	UpdateSetInputSchema,
	type CardInput,
} from '../schemas.js';
import { AUTHENTICATED, OPTIONAL_AUTH } from '../security.js';
import { deckShape, setEvent } from '../telemetry.js';
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

/**
 * Parse the stored attrs bag.
 *
 * Returns null rather than throwing on malformed JSON: the column is only ever
 * written from a validated serialization, so a bad value means corruption
 * upstream, and failing the whole GET would take the set's readable content
 * down with it. A card that loses its game attributes is still a flashcard.
 */
function parseAttrs(raw: string | null): Record<string, unknown> | null {
	if (raw === null || raw === '') return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

const toCardJson = (row: CardRow) => ({
	id: row.id,
	front: row.front,
	back: row.back,
	detail: row.detail,
	attrs: parseAttrs(row.attrs),
});

const listJson = (rows: SetWithCount[], viewerId: string | null) =>
	rows.map((row) => toSetJson(row, row.card_count, viewerId));

/** Columns bound per card row — keep in step with the INSERT below. */
export const CARD_COLUMNS = 7;

/**
 * Serialize a card's attrs for storage.
 *
 * The SIZE limit is enforced in the schema rather than here, so an oversized
 * bag is a validation error with a field path instead of an exception thrown
 * three layers down. An empty object stores as NULL: `{}` and "no attrs" mean
 * the same thing, and keeping one representation means a card cannot be
 * not-a-board-clue in two distinguishable ways.
 */
function serializeAttrs(attrs: CardInput['attrs']): string | null {
	if (attrs === null || attrs === undefined) return null;
	if (Object.keys(attrs).length === 0) return null;
	return JSON.stringify(attrs);
}

/**
 * D1's ceiling on bound parameters in ONE statement.
 *
 * 100, and emphatically NOT SQLite's 999 — which is what this file used to
 * claim. The difference is invisible until a set crosses the line and every
 * write of it 500s: with the five columns this table had at launch the break
 * was at 20 cards, so it sat here unnoticed while the only sets in existence
 * were smaller than that. Adding two columns moved the break to 14 and the
 * first real 25-clue board found it immediately.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * Rows per INSERT, DERIVED rather than chosen.
 *
 * Deriving it is the actual fix. A hand-picked constant has to be revisited by
 * whoever next adds a column, silently breaks large sets when they forget, and
 * gives no signal until someone writes a set past the new limit —
 * `sets.chunking.test.ts` pins the arithmetic so the mistake cannot recur.
 */
export const INSERT_CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CARD_COLUMNS);

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * The statements that swap a set's whole deck — NOT run here.
 *
 * Returned rather than executed so a caller can put them in the SAME D1 batch
 * as its own writes. `PUT /sets/{id}` replaces metadata and cards together and
 * must not be able to land half of that; composing one batch is what makes the
 * two atomic, since D1 runs a batch in an implicit transaction. A
 * delete-then-insert pair of separate statements could leave a set holding a
 * partial deck, and the failure would be silent data loss on someone's set.
 */
function cardReplacementStatements(db: D1Database, setId: string, cards: CardInput[]) {
	const inserts = chunk(cards, INSERT_CHUNK).map((group, groupIndex) => {
		const values = group.map((_, i) => {
			const p = i * CARD_COLUMNS;
			const slots = Array.from({ length: CARD_COLUMNS }, (_unused, n) => `?${p + n + 1}`);
			return `(${slots.join(', ')})`;
		});
		const bindings = group.flatMap((card, i) => {
			const position = groupIndex * INSERT_CHUNK + i;
			return [
				newId(),
				setId,
				card.front,
				card.back,
				position,
				// `?? null` rather than omitting: an absent optional field and an
				// explicit null both mean "not set", and D1 will not bind
				// `undefined`.
				card.detail ?? null,
				serializeAttrs(card.attrs),
			];
		});
		return db
			.prepare(
				`INSERT INTO cards (id, set_id, front, back, position, detail, attrs)
				 VALUES ${values.join(', ')}`
			)
			.bind(...bindings);
	});

	return [db.prepare(`DELETE FROM cards WHERE set_id = ?1`).bind(setId), ...inserts];
}

/** Swap a set's deck and stamp it as updated, as one transaction. */
function replaceCardsBatch(db: D1Database, setId: string, cards: CardInput[], now: number) {
	return db.batch([
		...cardReplacementStatements(db, setId, cards),
		db.prepare(`UPDATE sets SET updated_at = ?1 WHERE id = ?2`).bind(now, setId),
	]);
}

/**
 * Resolve a publish flag against what the set already is.
 *
 * Re-publishing an already-published set keeps the ORIGINAL published_at, so
 * the gallery's ordering reflects when a set was first shared rather than the
 * last time its owner toggled the switch. `undefined` leaves it untouched.
 */
function nextPublishedAt(current: number | null, published: boolean | undefined, now: number) {
	if (published === undefined) return current;
	return published ? (current ?? now) : null;
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
	security: AUTHENTICATED,
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
	security: OPTIONAL_AUTH,
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
		'Import a whole set in one request — title, description and every card. This is the write half of the single-file format: the `set` object from `GET /sets/{id}` may be POSTed back verbatim, extra fields and all. Pass `published: true` to share it on create rather than following up with a PATCH.',
	security: AUTHENTICATED,
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
	const publishedAt = input.published === true ? now : null;
	const cards = input.cards ?? [];

	// The set row and its cards go in ONE batch, so a create either lands whole
	// or not at all. Writing them as two awaited statements left an empty,
	// titled set behind whenever the card insert failed — which is exactly what
	// a run of them did on 2026-08-21, when every import over 14 cards hit D1's
	// parameter ceiling and the owner was left with debris they had to find and
	// delete by hand.
	await db.batch([
		db
			.prepare(
				`INSERT INTO sets (id, owner_user_id, title, description, published_at, created_at, updated_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`
			)
			.bind(id, writer.userId, input.title, input.description ?? null, publishedAt, now),
		...cardReplacementStatements(db, id, cards),
	]);

	const row: SetRow = {
		id,
		owner_user_id: writer.userId,
		title: input.title,
		description: input.description ?? null,
		published_at: publishedAt,
		created_at: now,
		updated_at: now,
	};

	setEvent('created', writer, id, {
		published: publishedAt !== null,
		...deckShape(cards),
	});

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
		'Returns the whole set in one response so the drill loop never needs a round trip between cards, and so a set can be exported as one file. Public when the set is published; otherwise owner-only.',
	security: OPTIONAL_AUTH,
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
		'Owner only, and a PARTIAL update — omitted fields are left alone, and cards are untouched. To write a whole set back from a file, use PUT instead. `published` is a per-set flag, not a separate copy: flipping it changes who may read the same rows.',
	security: AUTHENTICATED,
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
	const publishedAt = nextPublishedAt(row.published_at, patch.published, now);

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

	// Publishing is the state change worth being able to find later — it is the
	// one that changes who may read the rows — so it is called out rather than
	// left implicit in a generic "updated".
	setEvent('updated', writer, id, {
		published: publishedAt !== null,
		visibilityChanged: (row.published_at !== null) !== (publishedAt !== null),
		cards: count?.n ?? 0,
	});

	return okWrapped(c, {
		set: toSetJson(
			{ ...row, title, description, published_at: publishedAt, updated_at: now },
			count?.n ?? 0,
			writer.userId
		),
	});
});

// ============================================================================
// PUT /sets/:id — write a whole set back from a file
// ============================================================================

const replaceSetRoute = createRoute({
	method: 'put',
	path: '/sets/{id}',
	tags: ['Sets'],
	summary: 'Replace a whole set',
	description:
		'Owner only. The read half of the single-file format written back over an existing set: title, description and every card in ONE request, so a file that was exported, edited and re-imported does not need a PATCH and a card PUT to be sequenced by the caller. Metadata and cards land in a single transaction. Omitting `published` leaves visibility alone — a file describes content, and must not be able to silently unshare a set.',
	security: AUTHENTICATED,
	request: {
		params: z.object({ id: z.string() }),
		body: { content: { 'application/json': { schema: ReplaceSetInputSchema } }, required: true },
	},
	responses: {
		200: {
			description: 'Replaced',
			content: { 'application/json': { schema: SetDetailResponseSchema } },
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

app.openapi(replaceSetRoute, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const { id } = c.req.valid('param');
	const input = c.req.valid('json');
	const db = c.env.STUDY_DB;

	const row = await loadSetForWrite(db, id, writer.userId);
	if (!row) return notFoundWrapped(c, 'Set');

	const now = Date.now();
	const description = input.description ?? null;
	const publishedAt = nextPublishedAt(row.published_at, input.published, now);

	// One batch, so a set can never be left holding the new title and the old
	// deck. D1 wraps a batch in an implicit transaction; two awaited writes
	// would not be, and the window between them is exactly where an import of
	// someone's 500-card set would tear.
	await db.batch([
		...cardReplacementStatements(db, id, input.cards),
		db
			.prepare(
				`UPDATE sets SET title = ?1, description = ?2, published_at = ?3, updated_at = ?4 WHERE id = ?5`
			)
			.bind(input.title, description, publishedAt, now, id),
	]);

	setEvent('replaced', writer, id, {
		published: publishedAt !== null,
		...deckShape(input.cards),
	});

	return okWrapped(c, {
		set: {
			...toSetJson(
				{ ...row, title: input.title, description, published_at: publishedAt, updated_at: now },
				input.cards.length,
				writer.userId
			),
			cards: (await listCards(db, id)).map(toCardJson),
		},
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
	security: AUTHENTICATED,
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

	setEvent('deleted', writer, id, { published: row.published_at !== null });

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
	security: AUTHENTICATED,
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

	const row = await loadSetForWrite(db, id, writer.userId);
	if (!row) return notFoundWrapped(c, 'Set');

	await replaceCardsBatch(db, id, cards, Date.now());

	setEvent('cards-replaced', writer, id, deckShape(cards));

	return okWrapped(c, { cards: (await listCards(db, id)).map(toCardJson) });
});

export const setRoutes = app;
