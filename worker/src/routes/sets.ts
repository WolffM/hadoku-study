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
	tierAtLeast,
	type HadokuAuthContext,
} from '@wolffm/worker-utils';
import { isIdentityError, resolveGrantee } from '@wolffm/worker-utils/identity';
import {
	listFacts,
	listOwnedSets,
	listPublishedSets,
	loadSetById,
	loadSetForRead,
	loadSetForWrite,
	newId,
	type SetWithCount,
} from '../db.js';
import { readerUserId, resolveWriter } from '../auth.js';
import {
	CreateSetInputSchema,
	DeleteResponseSchema,
	ErrorResponseSchema,
	ReplaceSetInputSchema,
	SetDetailResponseSchema,
	SetResponseSchema,
	SetFileSchema,
	SetsResponseSchema,
	TransferOwnerInputSchema,
	TransferOwnerResponseSchema,
	UpdateSetInputSchema,
	type FactInput,
} from '../schemas.js';
import { askableByArchetype, askableFor, readFact, toSetFile } from '../factRows.js';
import type { Archetype } from '../variants.js';
import { AUTHENTICATED, OPTIONAL_AUTH } from '../security.js';
import { deckShape, setEvent } from '../telemetry.js';
import type { AppEnv, SetRow } from '../types.js';

interface RouteContext {
	Bindings: AppEnv;
	Variables: { authContext: HadokuAuthContext };
}

const app = new OpenAPIHono<RouteContext>();

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A set as a LIST entry — no variant count.
 *
 * Counting variants means expanding every fact of every set, and the only way
 * to avoid that in a list query would be to re-derive the expansion rule in
 * SQL: a second implementation of the one thing that must not have two. A list
 * says how many facts there are; the detail response says how many questions
 * they make.
 */
function toSetJson(row: SetRow, factCount: number, viewerId: string | null) {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		published: row.published_at !== null,
		factCount,
		isOwner: viewerId !== null && row.owner_user_id === viewerId,
		createdAt: iso(row.created_at),
		updatedAt: iso(row.updated_at),
	};
}

const listJson = (rows: SetWithCount[], viewerId: string | null) =>
	rows.map((row) => toSetJson(row, row.fact_count, viewerId));

/** Columns bound per fact row — keep in step with the INSERT below. */
export const FACT_COLUMNS = 8;

/**
 * Serialize a fact's attrs for storage.
 *
 * The SIZE limit is enforced in the schema rather than here, so an oversized
 * bag is a validation error with a field path instead of an exception thrown
 * three layers down. An empty object stores as NULL: `{}` and "no attrs" mean
 * the same thing, and keeping one representation means a fact cannot be
 * unclaimed-by-any-game in two distinguishable ways.
 */
function serializeAttrs(attrs: FactInput['attrs']): string | null {
	if (attrs === null || attrs === undefined) return null;
	if (Object.keys(attrs).length === 0) return null;
	return JSON.stringify(attrs);
}

/**
 * Same rule for declared questions: an empty array means "not declared",
 * which is what NULL already means. One representation, not two.
 *
 * Null is accepted as well as undefined because that is what a fact with no
 * declarations EXPORTS as, and the export has to parse straight back in.
 */
function serializeQuestions(questions: FactInput['questions']): string | null {
	if (questions === undefined || questions === null || questions.length === 0) return null;
	return JSON.stringify(questions);
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
export const INSERT_CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / FACT_COLUMNS);

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Decide what id each incoming fact keeps.
 *
 * Saving a set replaces its facts WHOLESALE — one DELETE, then INSERTs — which
 * in v1 was free, because nothing outside the set referred to a card by id.
 * Ratings changed that: they hang off `fact_id`, so re-minting ids on every
 * save would quietly discard the entire play history of a set each time its
 * owner fixed a typo. The rating would not be wrong, it would be GONE, with no
 * error anywhere.
 *
 * So an exported file carries each fact's id, and a PUT hands it back. An id
 * is honoured only when it already belongs to THIS set, which is what stops a
 * hand-edited file from adopting another set's rating history, and duplicates
 * within one payload are re-minted so two facts can never claim one row.
 */
export function resolveFactIds(facts: FactInput[], existing: Set<string>): string[] {
	const claimed = new Set<string>();
	return facts.map((fact) => {
		const wanted = fact.id;
		if (wanted !== undefined && existing.has(wanted) && !claimed.has(wanted)) {
			claimed.add(wanted);
			return wanted;
		}
		return newId();
	});
}

/**
 * The statements that swap a set's whole content — NOT run here.
 *
 * Returned rather than executed so a caller can put them in the SAME D1 batch
 * as its own writes. `PUT /sets/{id}` replaces metadata and facts together and
 * must not be able to land half of that; composing one batch is what makes the
 * two atomic, since D1 runs a batch in an implicit transaction. A
 * delete-then-insert pair of separate statements could leave a set holding
 * partial content, and the failure would be silent data loss on someone's set.
 */
function factReplacementStatements(
	db: D1Database,
	setId: string,
	facts: FactInput[],
	ids: string[]
) {
	const inserts = chunk(facts, INSERT_CHUNK).map((group, groupIndex) => {
		const values = group.map((_, i) => {
			const p = i * FACT_COLUMNS;
			const slots = Array.from({ length: FACT_COLUMNS }, (_unused, n) => `?${p + n + 1}`);
			return `(${slots.join(', ')})`;
		});
		const bindings = group.flatMap((fact, i) => {
			const position = groupIndex * INSERT_CHUNK + i;
			return [
				ids[position],
				setId,
				position,
				fact.archetype ?? null,
				JSON.stringify(fact.slots),
				serializeQuestions(fact.questions),
				// `?? null` rather than omitting: an absent optional field and an
				// explicit null both mean "not set", and D1 will not bind
				// `undefined`.
				fact.detail ?? null,
				serializeAttrs(fact.attrs),
			];
		});
		return db
			.prepare(
				`INSERT INTO facts (id, set_id, position, archetype, slots, questions, detail, attrs)
				 VALUES ${values.join(', ')}`
			)
			.bind(...bindings);
	});

	return [db.prepare(`DELETE FROM facts WHERE set_id = ?1`).bind(setId), ...inserts];
}

/** The ids a set's facts currently hold, so a PUT can hand them back. */
async function existingFactIds(db: D1Database, setId: string): Promise<Set<string>> {
	const res = await db
		.prepare(`SELECT id FROM facts WHERE set_id = ?1`)
		.bind(setId)
		.all<{ id: string }>();
	return new Set(res.results.map((row) => row.id));
}

/**
 * A set's declared archetypes, parsed.
 *
 * Stored as JSON text, so a row written by a newer deploy — or hand-edited —
 * must not take a read down. An unreadable value reads as "declares none",
 * which degrades a set to a one-column board rather than a 500.
 */
export function parseArchetypes(raw: string | null): Archetype[] | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as Archetype[]) : null;
	} catch {
		return null;
	}
}

/**
 * Delete the rating rows a save just orphaned.
 *
 * Two ways a rating becomes unreachable, and both are ordinary edits:
 *   - the FACT is gone, so every rating under its id is dead;
 *   - the fact survives but no longer asks that question — a renamed slot, a
 *     dropped declaration, an archetype narrowed so the slot is not askable.
 *
 * Chunked against D1's bound-parameter ceiling, which is 100 and not SQLite's
 * 999 — the same ceiling `INSERT_CHUNK` is derived from, and the same one that
 * broke every write of a set over 20 cards when it was assumed to be larger.
 */
function deadRatingStatements(
	db: D1Database,
	stored: { id: string; variants: { key: string }[] }[],
	priorIds: Set<string>,
	liveIds: Set<string>
): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [];
	const tables = ['variant_ratings', 'user_variant_ratings'] as const;

	// Facts that no longer exist at all.
	const removed = [...priorIds].filter((factId) => !liveIds.has(factId));
	for (const group of chunk(removed, D1_MAX_BOUND_PARAMS)) {
		const holes = group.map((_, i) => `?${i + 1}`).join(', ');
		for (const table of tables) {
			statements.push(
				db.prepare(`DELETE FROM ${table} WHERE fact_id IN (${holes})`).bind(...group)
			);
		}
	}

	// Facts that survived, but whose question list moved under them.
	for (const fact of stored) {
		const keys = fact.variants.map((variant) => variant.key);
		for (const table of tables) {
			if (keys.length === 0) {
				statements.push(db.prepare(`DELETE FROM ${table} WHERE fact_id = ?1`).bind(fact.id));
				continue;
			}
			// One statement per fact: a fact has at most MAX_SLOTS_PER_FACT
			// variants, so this is nowhere near the ceiling, and a NOT IN over
			// every fact's keys at once would blow straight through it.
			const holes = keys.map((_, i) => `?${i + 2}`).join(', ');
			statements.push(
				db
					.prepare(`DELETE FROM ${table} WHERE fact_id = ?1 AND variant_key NOT IN (${holes})`)
					.bind(fact.id, ...keys)
			);
		}
	}

	return statements;
}

/**
 * Archetypes as stored: JSON text, or NULL for a set declaring none.
 *
 * NULL and `[]` collapse to NULL deliberately — "has not decided" and "decided
 * on nothing" would otherwise be two representations of the same one-column
 * board, and every reader would have to know they mean the same thing.
 */
function serializeArchetypes(archetypes: Archetype[] | null | undefined): string | null {
	if (!archetypes || archetypes.length === 0) return null;
	return JSON.stringify(archetypes);
}

/**
 * Read a set's facts back as the API returns them.
 *
 * Each fact is expanded against its own archetype's `ask` list. Note the
 * explicit arrow rather than `.map(readFact)`: `readFact` takes a second
 * parameter and `Array.map` passes the INDEX into it, which typechecks as
 * nothing and would silently expand every fact against garbage.
 */
async function factsJson(db: D1Database, setId: string, row: SetRow) {
	const byName = askableByArchetype(parseArchetypes(row.archetypes));
	const facts = await listFacts(db, setId);
	return facts.map((fact) => readFact(fact, askableFor(fact, byName)));
}

/** A set with its whole content, counted from the facts it is already sending. */
function toSetDetailJson<F extends { variants: unknown[] }>(
	row: SetRow,
	facts: F[],
	viewerId: string | null
) {
	return {
		...toSetJson(row, facts.length, viewerId),
		variantCount: facts.reduce((total, fact) => total + fact.variants.length, 0),
		facts,
	};
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
	const facts = input.facts ?? [];
	// Every id is minted. A create has no set for an incoming id to belong to,
	// so honouring one would let a file claim rating history it never earned.
	const ids = facts.map(() => newId());

	// The set row and its facts go in ONE batch, so a create either lands whole
	// or not at all. Writing them as two awaited statements left an empty,
	// titled set behind whenever the card insert failed — which is exactly what
	// a run of them did on 2026-08-21, when every import over 14 cards hit D1's
	// parameter ceiling and the owner was left with debris they had to find and
	// delete by hand.
	await db.batch([
		db
			.prepare(
				`INSERT INTO sets (id, owner_user_id, title, description, archetypes, published_at, created_at, updated_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`
			)
			.bind(
				id,
				writer.userId,
				input.title,
				input.description ?? null,
				serializeArchetypes(input.archetypes),
				publishedAt,
				now
			),
		...factReplacementStatements(db, id, facts, ids),
	]);

	const row: SetRow = {
		id,
		owner_user_id: writer.userId,
		title: input.title,
		description: input.description ?? null,
		archetypes: serializeArchetypes(input.archetypes),
		published_at: publishedAt,
		created_at: now,
		updated_at: now,
	};

	const stored = await factsJson(db, id, row);

	setEvent('created', writer, id, {
		published: publishedAt !== null,
		...deckShape(stored),
	});

	return createdWrapped(c, { set: toSetDetailJson(row, stored, writer.userId) });
});

// ============================================================================
// GET /sets/:id — detail, with every card
// ============================================================================

const getSetRoute = createRoute({
	method: 'get',
	path: '/sets/{id}',
	tags: ['Sets'],
	summary: 'Get a set and all of its facts',
	description:
		'Returns the whole set in one response — every fact, each already expanded into the questions it can be asked as — so a game never needs a round trip mid-play and a set can be exported as one file. Public when the set is published; otherwise owner-only.',
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

	const facts = await factsJson(db, id, row);
	return okWrapped(c, { set: toSetDetailJson(row, facts, viewerId) });
});

// ============================================================================
// GET /sets/:id/file — the set as one portable document
// ============================================================================

const getFileRoute = createRoute({
	method: 'get',
	path: '/sets/{id}/file',
	tags: ['Sets'],
	summary: 'The set as a single file',
	description:
		'The same content as `GET /sets/{id}`, as a BARE document — no success envelope, no derived fields — so it can be piped straight into a file or pasted into an agent. It is a valid `PUT /sets/{id}` body exactly as it comes, fact ids included, which is what keeps a round trip from discarding the set’s rating history. Public when the set is published; otherwise owner-only.',
	security: OPTIONAL_AUTH,
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			description: 'The file',
			content: { 'application/json': { schema: SetFileSchema } },
		},
		404: {
			description: 'No such set — or it is private and not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(getFileRoute, async (c) => {
	const { id } = c.req.valid('param');
	const db = c.env.STUDY_DB;

	const row = await loadSetForRead(db, id, readerUserId(c));
	if (!row) return notFoundWrapped(c, 'Set');

	// The one route that answers unwrapped. Everything else in this worker uses
	// the wrapped format, and that is still right — but a document a person
	// copies should not arrive inside an envelope they have to unwrap first.
	const archetypes = parseArchetypes(row.archetypes);
	const byName = askableByArchetype(archetypes);
	const facts = (await listFacts(db, id)).map((fact) => readFact(fact, askableFor(fact, byName)));
	return c.json(toSetFile({ ...row, archetypes }, facts), 200);
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
		'Owner only, and a PARTIAL update — omitted fields are left alone, and facts are untouched. To write a whole set back from a file, use PUT instead. `published` is a per-set flag, not a separate copy: flipping it changes who may read the same rows.',
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
		.prepare(`SELECT COUNT(*) AS n FROM facts WHERE set_id = ?1`)
		.bind(id)
		.first<{ n: number }>();

	// Publishing is the state change worth being able to find later — it is the
	// one that changes who may read the rows — so it is called out rather than
	// left implicit in a generic "updated".
	setEvent('updated', writer, id, {
		published: publishedAt !== null,
		visibilityChanged: (row.published_at !== null) !== (publishedAt !== null),
		facts: count?.n ?? 0,
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
		'Owner only. The single-file format written back over an existing set: title, description and every fact in ONE request and ONE transaction. Send each fact back with the `id` it was exported with — an id that already belongs to this set is kept, which is what preserves the ratings hanging off it; anything else is minted fresh. Omitting `published` leaves visibility alone: a file describes content, and must not be able to silently unshare a set.',
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
	const archetypesJson = serializeArchetypes(input.archetypes);
	const publishedAt = nextPublishedAt(row.published_at, input.published, now);
	// Read BEFORE the swap: this is what lets a fact keep its id, and with it
	// every rating hanging off that id.
	const priorIds = await existingFactIds(db, id);
	const ids = resolveFactIds(input.facts, priorIds);

	// One batch, so a set can never be left holding the new title and the old
	// content. D1 wraps a batch in an implicit transaction; two awaited writes
	// would not be, and the window between them is exactly where an import of
	// someone's 500-fact set would tear.
	await db.batch([
		...factReplacementStatements(db, id, input.facts, ids),
		db
			.prepare(
				`UPDATE sets SET title = ?1, description = ?2, archetypes = ?3, published_at = ?4, updated_at = ?5 WHERE id = ?6`
			)
			.bind(input.title, description, archetypesJson, publishedAt, now, id),
	]);

	const stored = await factsJson(db, id, { ...row, archetypes: archetypesJson });

	// A save can retire a question — a slot renamed, a declaration dropped, an
	// archetype narrowed so a slot is no longer asked. The rating rows behind
	// those questions are now unreachable: nothing will ever read them, nothing
	// will ever move them, and they would sit in the table looking like data.
	//
	// So they are DELETED rather than left. Kept separate from the batch above
	// on purpose — the save is the thing that must be atomic, and a sweep that
	// failed would leave rows nobody reads rather than a torn set. It is also
	// re-runnable: the next save of the same set sweeps whatever this one
	// missed.
	//
	// `attempts` is deliberately NOT swept. It is the append-only ledger of
	// what somebody actually answered and when, with the ratings before and
	// after; that a question has since been retired does not make the answer
	// untrue. Ratings are derived state and can be wrong; the ledger is
	// history and can only be incomplete.
	const sweep = deadRatingStatements(db, stored, priorIds, new Set(ids));
	if (sweep.length > 0) await db.batch(sweep);

	setEvent('replaced', writer, id, {
		published: publishedAt !== null,
		// How much of the set kept its identity. A save that re-mints every id
		// has thrown away a set's whole rating history, and this is the only
		// place that would show it.
		keptIds: ids.filter((factId) => priorIds.has(factId)).length,
		...deckShape(stored),
	});

	return okWrapped(c, {
		set: toSetDetailJson(
			{ ...row, title: input.title, description, published_at: publishedAt, updated_at: now },
			stored,
			writer.userId
		),
	});
});

// ============================================================================
// POST /sets/:id/owner — hand a set to someone else
// ============================================================================

const transferOwnerRoute = createRoute({
	method: 'post',
	path: '/sets/{id}/owner',
	tags: ['Sets'],
	summary: 'Hand a set to another user',
	description:
		'Owner only, or admin. You can GIVE a set away; you cannot take one — a caller who is neither the current owner nor an admin gets the same 404 as a set that does not exist, so probing reveals nothing. Name the recipient by their registry display NAME (the sharing picker at `GET /session/users/search` lists them); the name is resolved against the key registry and the resulting userId is what gets stored, so a name nobody holds is a 404 rather than a set assigned to nobody. Omit the body to claim the set for yourself, which is how an admin adopts a set whose owner no longer holds a key. Nothing else moves: facts keep their ids, and ratings, attempts and saved progress are keyed on the READER rather than on the owner, so no one loses anything.',
	security: AUTHENTICATED,
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: { 'application/json': { schema: TransferOwnerInputSchema } },
			required: true,
		},
	},
	responses: {
		200: {
			description: 'Handed over',
			content: { 'application/json': { schema: TransferOwnerResponseSchema } },
		},
		403: {
			description: 'Not signed in, or below friend tier',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description:
				'No such set — or not yours and you are not an admin — or no live key carries that name (NAME_NOT_FOUND)',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		409: {
			description: 'That name belongs to a key that has never signed in, so it has no id yet',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(transferOwnerRoute, async (c) => {
	const writer = resolveWriter(c);
	if (!writer.ok)
		return c.json({ success: false, error: 'Forbidden', message: writer.message }, 403);

	const { id } = c.req.valid('param');
	const { name } = c.req.valid('json');
	const db = c.env.STUDY_DB;

	// An admin may move any set — the escape hatch for one assigned to a userId
	// nobody holds a key for, which is otherwise unreachable through the API.
	// Everyone else is held to the same owner check as any other write, which
	// is what makes this a way to GIVE rather than a way to take.
	const admin = tierAtLeast(c.get('authContext'), 'admin');
	const row = admin ? await loadSetById(db, id) : await loadSetForWrite(db, id, writer.userId);
	if (!row) return notFoundWrapped(c, 'Set');

	// Resolve the NAME to an owner (R4/R5). The empty-body branch is untouched:
	// claiming a set for yourself needs no lookup, because the caller's identity
	// was already resolved at the edge — and that branch is the one that
	// RECOVERED the 2026-08-25 incident, so it is correct by construction.
	let nextOwner = writer.userId;
	let grantee: { name: string | null; tier?: string } | null = null;
	if (name !== undefined) {
		const resolved = await resolveGrantee(c.env, { name });
		if (isIdentityError(resolved)) {
			return c.json(
				{
					success: false,
					error: resolved.code === 'NO_USER_ID' ? 'Conflict' : 'Not Found',
					message: resolved.error,
				},
				resolved.status === 409 ? 409 : 404
			);
		}
		nextOwner = resolved.userId;
		grantee = { name: resolved.name, tier: resolved.tier };
	}
	const now = Date.now();

	if (nextOwner !== row.owner_user_id) {
		await db
			.prepare(`UPDATE sets SET owner_user_id = ?1, updated_at = ?2 WHERE id = ?3`)
			.bind(nextOwner, now, id)
			.run();
	}

	const count = await db
		.prepare(`SELECT COUNT(*) AS n FROM facts WHERE set_id = ?1`)
		.bind(id)
		.first<{ n: number }>();

	// Worth being able to find later: it is the one change that alters who may
	// edit a set, and the only one that cannot be undone by its new owner
	// without the old one's cooperation.
	setEvent('owner-changed', writer, id, {
		from: row.owner_user_id,
		to: nextOwner,
		byAdmin: admin && row.owner_user_id !== writer.userId,
	});

	// Echo who it went to, so a human can confirm the identity before the change
	// stops being undoable without the new owner's cooperation (R4).
	return okWrapped(c, {
		set: toSetJson({ ...row, owner_user_id: nextOwner, updated_at: now }, count?.n ?? 0, nextOwner),
		...(grantee ? { grantedTo: { name: grantee.name, tier: grantee.tier ?? null } } : {}),
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
	description:
		'Owner only. Facts, ratings, attempt history and every reader’s saved progress go with it.',
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
	// would strand rows for a set that no longer exists.
	//
	// Ratings key on `fact_id`, so they have to go BEFORE the facts they name —
	// once the facts are gone there is nothing left to select them by, and the
	// rows would be unreachable rather than merely orphaned.
	await db.batch([
		db
			.prepare(
				`DELETE FROM variant_ratings WHERE fact_id IN (SELECT id FROM facts WHERE set_id = ?1)`
			)
			.bind(id),
		db
			.prepare(
				`DELETE FROM user_variant_ratings WHERE fact_id IN (SELECT id FROM facts WHERE set_id = ?1)`
			)
			.bind(id),
		db.prepare(`DELETE FROM attempts WHERE set_id = ?1`).bind(id),
		db.prepare(`DELETE FROM facts WHERE set_id = ?1`).bind(id),
		db.prepare(`DELETE FROM set_progress WHERE set_id = ?1`).bind(id),
		db.prepare(`DELETE FROM sets WHERE id = ?1`).bind(id),
	]);

	setEvent('deleted', writer, id, { published: row.published_at !== null });

	return okWrapped(c, { setId: id });
});

export const setRoutes = app;
