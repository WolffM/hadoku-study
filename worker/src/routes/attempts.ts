/**
 * What you answered, and what it did to the question.
 *
 * Two routes, one model. `GET /ratings` says how every question in a set
 * stands; `POST /attempts` records answers and moves them. Both are gated on
 * IDENTITY rather than tier, exactly like progress: this is private data about
 * a set the caller can already read, so the question is only "who is this",
 * never "are they friend+".
 *
 * A signed-out reader has no identity and therefore writes nothing — there is
 * no row to attribute an attempt to and no way to tell one anonymous reader
 * from a thousand, so letting them move global ratings would be letting an
 * unbounded, unattributable population vote. Their play still adapts; their
 * ratings just live in the browser.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { notFoundWrapped, okWrapped, type HadokuAuthContext } from '@wolffm/worker-utils';
import {
	listFacts,
	loadGlobalRatings,
	loadSetForRead,
	newId,
	MAX_ATTEMPTS_PER_REQUEST,
} from '../db.js';
import { moveLegacyRows } from '../legacy.js';
import {
	deleteItem,
	keys,
	personOf,
	putItem,
	readerRatings,
	type AttemptRecord,
	type Person,
} from '../person.js';
import { readFact, variantId } from '../factRows.js';
import { drift, initialState, poolMean, seedRating, type RatingState } from '../rating.js';
import {
	ErrorResponseSchema,
	RatingChangesResponseSchema,
	RatingsResponseSchema,
	RecordAttemptsInputSchema,
} from '../schemas.js';
import { AUTHENTICATED } from '../security.js';
import { attemptEvent } from '../telemetry.js';
import type { AppEnv, RatingRow } from '../types.js';

interface RouteContext {
	Bindings: AppEnv;
	Variables: { authContext: HadokuAuthContext };
}

const app = new OpenAPIHono<RouteContext>();

const params = z.object({ id: z.string() });

const forbidden = (message: string) => ({ success: false, error: 'Forbidden', message }) as const;

const NEEDS_IDENTITY =
	'Recording answers needs an account. Signed-out readers keep their ratings on the device.';

// ============================================================================
// The model both routes share
// ============================================================================

interface VariantRef {
	factId: string;
	variantKey: string;
	seedTier: number;
}

const stateOf = (row: RatingRow | undefined, fallback: number): RatingState =>
	row
		? { rating: row.rating, plays: row.plays, run: row.run, runResult: row.run_result }
		: initialState(fallback);

/**
 * Every question in a set, with where it stands in both scopes.
 *
 * Nothing is materialised. A question with no rating row is not missing a
 * value — it sits at a real estimate, and computing that on read is what lets
 * a set be played without first writing a row for every question in it.
 *
 * The two seeds differ, and the difference is the whole global/local design:
 *
 * - GLOBAL falls back to the question's `seedTier`, which is the author's
 *   opinion and the only prior that exists before anyone has played.
 * - LOCAL falls back to the CURRENT GLOBAL rating. So the first time you
 *   attempt a question you start from what everyone else has learned about it,
 *   and from then on it is yours alone.
 *
 * That is per-question rather than per-set: a question you have never seen
 * still starts from whatever global has since learned, which is strictly
 * better than freezing your whole set at whatever global said the day you
 * first opened it.
 */
async function ratingsFor(db: D1Database, env: AppEnv, setId: string, person: Person | null) {
	const variants: VariantRef[] = [];
	for (const row of await listFacts(db, setId)) {
		for (const variant of readFact(row).variants) {
			variants.push({ factId: row.id, variantKey: variant.key, seedTier: variant.seedTier });
		}
	}

	const globalRows = new Map<string, RatingRow>();
	for (const row of await loadGlobalRatings(db, setId)) {
		globalRows.set(variantId(row.fact_id, row.variant_key), row);
	}

	// The reader's own, from their prefs-api items (person.ts, R12).
	const userRows = person ? await readerRatings(env, person, setId) : new Map<string, never>();

	const entries = variants.map((ref) => {
		const id = variantId(ref.factId, ref.variantKey);
		const globalState = stateOf(globalRows.get(id), seedRating(ref.seedTier));
		const own = userRows.get(id);
		const localState = own ? own.state : initialState(globalState.rating);
		return { ...ref, id, globalState, localState };
	});

	// A rating of a question this set no longer asks (a slot renamed or
	// dropped) is never read again. A save sweeps a REMOVED fact from every
	// reader; a question that changed under a surviving fact is cleaned here,
	// from the reader's own items, the next time they open the set.
	if (person) {
		const asked = new Set(entries.map((entry) => entry.id));
		for (const [id, own] of userRows) {
			if (!asked.has(id)) await deleteItem(env, person, own.key);
		}
	}

	return {
		entries,
		// One field per scope. Measuring a local rating against the global mean
		// would drag every one of your ratings toward a population you are not
		// part of, which is the opposite of what a personal rating is for.
		globalMean: poolMean(entries.map((e) => e.globalState.rating)),
		localMean: poolMean(entries.map((e) => e.localState.rating)),
	};
}

type Entry = Awaited<ReturnType<typeof ratingsFor>>['entries'][number];

const toJson = (entry: Entry) => ({
	factId: entry.factId,
	variantKey: entry.variantKey,
	global: entry.globalState.rating,
	local: entry.localState.rating,
	globalPlays: entry.globalState.plays,
	yourPlays: entry.localState.plays,
});

// ============================================================================
// GET /sets/:id/ratings
// ============================================================================

const getRatingsRoute = createRoute({
	method: 'get',
	path: '/sets/{id}/ratings',
	tags: ['Ratings'],
	summary: 'How every question in a set stands',
	description:
		'One entry per question, in both scopes. `global` is everyone’s and starts at the question’s `seedTier`; `local` is yours and starts at whatever `global` says the first time you attempt that question, after which nothing overwrites it. Nothing is written by this call. Requires an account — a signed-out reader keeps ratings on the device.',
	security: AUTHENTICATED,
	request: { params },
	responses: {
		200: {
			description: 'Every question, rated',
			content: { 'application/json': { schema: RatingsResponseSchema } },
		},
		403: {
			description: 'Not signed in',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description: 'No such set — or it is private and not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(getRatingsRoute, async (c) => {
	const person = personOf(c);
	if (person === null) return c.json(forbidden(NEEDS_IDENTITY), 403);

	const { id } = c.req.valid('param');
	const db = c.env.STUDY_DB;

	const set = await loadSetForRead(db, id, person.userId);
	if (!set) return notFoundWrapped(c, 'Set');

	await moveLegacyRows(db, c.env, person);
	const { entries } = await ratingsFor(db, c.env, id, person);
	return okWrapped(c, { ratings: entries.map(toJson) });
});

// ============================================================================
// POST /sets/:id/attempts
// ============================================================================

const recordRoute = createRoute({
	method: 'post',
	path: '/sets/{id}/attempts',
	tags: ['Ratings'],
	summary: 'Record answers and move the ratings',
	description: `Self-graded, and that is the whole grading story — open-ended and discrete questions travel the identical path. Every attempt is appended to a permanent ledger with the rating before and after, so a change to the drift formula can be replayed over history rather than orphaning it. Send one per answer; the batch form (up to ${MAX_ATTEMPTS_PER_REQUEST}) exists so a client that was offline can flush what it held. Returns the new standing of every question it touched.`,
	security: AUTHENTICATED,
	request: {
		params,
		body: {
			content: { 'application/json': { schema: RecordAttemptsInputSchema } },
			required: true,
		},
	},
	responses: {
		200: {
			description: 'Recorded, with what each answer moved',
			content: { 'application/json': { schema: RatingChangesResponseSchema } },
		},
		400: {
			description: 'An attempt names a question this set does not ask',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		403: {
			description: 'Not signed in',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
		404: {
			description: 'No such set — or it is private and not yours',
			content: { 'application/json': { schema: ErrorResponseSchema } },
		},
	},
});

app.openapi(recordRoute, async (c) => {
	const person = personOf(c);
	if (person === null) return c.json(forbidden(NEEDS_IDENTITY), 403);

	const { id } = c.req.valid('param');
	const input = c.req.valid('json');
	const db = c.env.STUDY_DB;

	const set = await loadSetForRead(db, id, person.userId);
	if (!set) return notFoundWrapped(c, 'Set');

	await moveLegacyRows(db, c.env, person);
	const { entries, globalMean, localMean } = await ratingsFor(db, c.env, id, person);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));

	// Validated against the EXPANDED set, not against the stored ratings. A key
	// that no fact asks any more — because a slot was renamed — must not quietly
	// open a rating nothing will ever read again.
	const unknown = input.attempts.find(
		(attempt) => !byId.has(variantId(attempt.factId, attempt.variantKey))
	);
	if (unknown) {
		return c.json(
			{
				success: false,
				error: 'Bad Request',
				message: `This set has no question ${variantId(unknown.factId, unknown.variantKey)}.`,
			},
			400
		);
	}

	const now = Date.now();
	const globalWrites: D1PreparedStatement[] = [];
	// Accumulated rather than assigned, because one request may name the same
	// question twice — a flushed outbox replaying an offline patch does exactly
	// that, and a recap showing only the last move would understate it.
	const moved = new Map<string, { global: number; local: number }>();

	// The same id twice in ONE request (an outbox flushed twice concurrently).
	// Across requests the ledger itself answers, below.
	const { fresh, skipped: repeated } = unseenAnswers(input.attempts, new Set());
	let skipped = repeated;

	for (const attempt of fresh) {
		const entry = byId.get(variantId(attempt.factId, attempt.variantKey));
		if (!entry) continue;
		const result = attempt.result;

		// The field is held FIXED across a batch. Recomputing it between attempts
		// would make each answer's effect depend on the order the others happened
		// to arrive in, which is not something a reader could see or reason about.
		const globalDrift = drift(entry.globalState, globalMean, result);
		const localDrift = drift(entry.localState, localMean, result);

		// The ledger entry FIRST, and create-only: a retry is the normal case
		// (the client keeps an answer until a send is confirmed, so a request
		// whose reply was lost arrives again), and an answer the ledger already
		// holds must not move a rating twice. Its id is the client's when it sent
		// one, so a retry collides with itself. Ordered before the rating writes,
		// a crash between the two loses one answer's drift; the other order would
		// count it twice on the retry.
		const record: AttemptRecord = {
			factId: entry.factId,
			variantKey: entry.variantKey,
			game: input.game,
			result,
			response: attempt.response ?? null,
			// The reader's own rating, because that is the number this attempt
			// was answered against and the one a replay would need to reproduce.
			ratingBefore: entry.localState.rating,
			ratingAfter: localDrift.next.rating,
			createdAt: now,
		};
		const recorded = await putItem(
			c.env,
			person,
			keys.attempt(id, attempt.attemptId ?? newId()),
			record,
			0
		);
		if (!recorded) {
			skipped++;
			continue;
		}

		await putItem(c.env, person, keys.rating(id, entry.factId, entry.variantKey), localDrift.next);
		globalWrites.push(
			upsertGlobalRating(db, entry.factId, entry.variantKey, globalDrift.next, now)
		);

		// Mutated in place so a batch that names one question twice compounds
		// correctly instead of writing the first outcome twice.
		entry.globalState = globalDrift.next;
		entry.localState = localDrift.next;
		const running = moved.get(entry.id) ?? { global: 0, local: 0 };
		moved.set(entry.id, {
			global: running.global + globalDrift.delta,
			local: running.local + localDrift.delta,
		});
	}

	// Guarded because a request in which EVERY answer was already held is an
	// ordinary outcome — the confirmed-delivery retry — and `batch([])` is not
	// something to find out about in production.
	if (globalWrites.length > 0) await db.batch(globalWrites);

	attemptEvent(person.userId, id, input.game, input.attempts.length - skipped, skipped);

	return okWrapped(c, {
		ratings: entries
			.filter((entry) => moved.has(entry.id))
			.map((entry) => {
				const delta = moved.get(entry.id) ?? { global: 0, local: 0 };
				return { ...toJson(entry), globalDelta: delta.global, localDelta: delta.local };
			}),
	});
});

/**
 * The answers in a batch this ledger has not already recorded.
 *
 * The client keeps an answer until a send is CONFIRMED, so a request whose
 * reply was lost — a closed tab, a dead tunnel — arrives again in full. That
 * makes delivery at-least-once and this function is what makes the ledger
 * exactly-once.
 *
 * Two sources of repetition, one rule:
 *   - across requests, via `held` (what the table already has);
 *   - WITHIN one request, because an outbox flushed twice concurrently puts
 *     the same id in one batch. Marking as it goes covers both.
 *
 * An attempt with no `attemptId` is always fresh: it came from a bundle older
 * than the idempotency key and there is nothing to match it on. That is the
 * pre-existing behaviour, unchanged — it cannot dedupe, and it must not drop.
 */
export function unseenAnswers<T extends { attemptId?: string }>(
	attempts: readonly T[],
	held: ReadonlySet<string>
): { fresh: T[]; skipped: number } {
	const seen = new Set(held);
	const fresh: T[] = [];
	let skipped = 0;
	for (const attempt of attempts) {
		if (attempt.attemptId === undefined) {
			fresh.push(attempt);
			continue;
		}
		if (seen.has(attempt.attemptId)) {
			skipped++;
			continue;
		}
		seen.add(attempt.attemptId);
		fresh.push(attempt);
	}
	return { fresh, skipped };
}

/** Write the shared rating of one question, creating it on its first attempt. */
function upsertGlobalRating(
	db: D1Database,
	factId: string,
	variantKey: string,
	next: RatingState,
	now: number
): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO variant_ratings (rating, plays, run, run_result, updated_at, fact_id, variant_key)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT (fact_id, variant_key) DO UPDATE SET
			   rating = ?1, plays = ?2, run = ?3, run_result = ?4, updated_at = ?5`
		)
		.bind(next.rating, next.plays, next.run, next.runResult, now, factId, variantKey);
}

export const attemptRoutes = app;
