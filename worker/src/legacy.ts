/**
 * A reader's rows from before R12, moved to their prefs-api items on their next
 * request (person.ts).
 *
 * The worker can write a reader's items only as that reader, with the key the
 * edge forwards on their own request, so the move cannot be a one-off backfill:
 * it happens the first time each reader comes back. Every item is written
 * CREATE-ONLY, so anything already written the new way wins over the old row,
 * and the D1 rows are deleted only after every write landed; a failure leaves
 * them for the next request. When no reader has rows left, the three tables
 * are dropped (a migration) and this file goes with them.
 */
import {
	keys,
	putItem,
	type AttemptRecord,
	type Person,
	type Progress,
	type RatingState,
} from './person.js';
import type { AppEnv } from './types.js';

interface LegacyRating {
	fact_id: string;
	variant_key: string;
	set_id: string | null;
	rating: number;
	plays: number;
	run: number;
	run_result: string | null;
}

interface LegacyProgress {
	set_id: string;
	queue: string;
	results: string;
	updated_at: number;
}

interface LegacyAttempt {
	id: string;
	set_id: string;
	fact_id: string;
	variant_key: string;
	game: string;
	result: string;
	response: string | null;
	rating_before: number;
	rating_after: number;
	created_at: number;
}

/** Answers how many rows moved (0 when the reader had none, which is the common case). */
export async function moveLegacyRows(db: D1Database, env: AppEnv, person: Person): Promise<number> {
	const [ratings, progress, attempts] = await Promise.all([
		db
			.prepare(
				`SELECT r.fact_id, r.variant_key, f.set_id, r.rating, r.plays, r.run, r.run_result
				 FROM user_variant_ratings r LEFT JOIN facts f ON f.id = r.fact_id
				 WHERE r.user_id = ?1`
			)
			.bind(person.userId)
			.all<LegacyRating>(),
		db
			.prepare(`SELECT set_id, queue, results, updated_at FROM set_progress WHERE user_id = ?1`)
			.bind(person.userId)
			.all<LegacyProgress>(),
		db
			.prepare(
				`SELECT id, set_id, fact_id, variant_key, game, result, response, rating_before, rating_after, created_at
				 FROM attempts WHERE user_id = ?1`
			)
			.bind(person.userId)
			.all<LegacyAttempt>(),
	]);
	const total = ratings.results.length + progress.results.length + attempts.results.length;
	if (total === 0) return 0;

	for (const r of ratings.results) {
		// A rating whose fact is gone named a question nobody asks any more.
		if (r.set_id === null) continue;
		const state: RatingState = {
			rating: r.rating,
			plays: r.plays,
			run: r.run,
			runResult: r.run_result,
		};
		await putItem(env, person, keys.rating(r.set_id, r.fact_id, r.variant_key), state, 0);
	}
	for (const p of progress.results) {
		const value: Progress = {
			queue: JSON.parse(p.queue) as string[],
			results: JSON.parse(p.results) as Record<string, 'got' | 'missed'>,
			updatedAt: p.updated_at,
		};
		await putItem(env, person, keys.progress(p.set_id), value, 0);
	}
	for (const a of attempts.results) {
		const value: AttemptRecord = {
			factId: a.fact_id,
			variantKey: a.variant_key,
			game: a.game,
			result: a.result,
			response: a.response,
			ratingBefore: a.rating_before,
			ratingAfter: a.rating_after,
			createdAt: a.created_at,
		};
		await putItem(env, person, keys.attempt(a.set_id, a.id), value, 0);
	}

	await db.batch([
		db.prepare(`DELETE FROM user_variant_ratings WHERE user_id = ?1`).bind(person.userId),
		db.prepare(`DELETE FROM set_progress WHERE user_id = ?1`).bind(person.userId),
		db.prepare(`DELETE FROM attempts WHERE user_id = ?1`).bind(person.userId),
	]);
	return total;
}
