/**
 * How a question's difficulty drifts.
 *
 * Elo's skeleton with the opponent swapped. Standard elo rates two players
 * against each other; here there is no player rating, because what we want to
 * learn is how hard a QUESTION is, not how good you are. So the opponent is
 * THE FIELD — the mean rating of the set the question was drawn from — and a
 * question "wins" the match when you miss it.
 *
 * That gets the property the design actually asked for, cards ranked against
 * each other, while keeping the one thing that makes elo self-correcting: as a
 * rating moves away from the field, further movement in that direction gets
 * harder. A question already rated brutal barely moves when you miss it,
 * because that outcome was expected and carries almost no information. Nailing
 * that same question is a surprise, and drops it hard.
 *
 * Three knobs, each earning its place:
 *
 *   E  the field   — how much of a surprise this outcome was
 *   K  confidence  — a new question swings; a well-played one barely moves
 *   M  the streak  — consecutive identical outcomes hit harder
 *
 * Pure, and deliberately so: every number here is replayable over the
 * `attempts` ledger, which stores the rating before and after precisely so a
 * change to this file can be re-run over history instead of orphaning it.
 */

/** The field's nominal centre, and where an unseeded question starts. */
export const BASE_RATING = 1200;
/**
 * Hard bounds.
 *
 * Nothing reads an absolute rating — only relative order decides which
 * question lands in which row — so a clamp is enough and no re-centering pass
 * is needed. Without one, a reader who gets everything right forever drags the
 * whole set down without limit, since the field sinks with it.
 *
 * The cost is that questions piled at the floor lose their order relative to
 * each other. That is the correct trade: they are exactly the ones that should
 * all be equally deprioritised.
 */
export const MIN_RATING = 600;
export const MAX_RATING = 1800;

/** Elo's spread constant. 400 means a 400-point gap is ~10:1 odds. */
const SCALE = 400;

/** K when a question is brand new. Roughly a 20-point move at the field mean. */
const K_MAX = 40;
/** Plays at which K has fallen to half of K_MAX. */
const K_HALF_LIFE = 8;

/** Each additional consecutive identical outcome adds this much multiplier. */
const STREAK_STEP = 0.5;
/**
 * Ceiling on the streak multiplier.
 *
 * Capped because a long run says the same thing over and over — the tenth miss
 * in a row is not five times the evidence of the third — and without a cap one
 * stubborn question would slam into the ceiling and stop being orderable
 * against its neighbours.
 */
const STREAK_CAP = 3;

/**
 * A tier's starting rating.
 *
 * Tiers 1–5 map to 1000–1400, centred on {@link BASE_RATING}, so a freshly
 * authored board seeds in exactly the order its author intended and drift takes
 * over from there. `seedTier` is a STARTING POINT and nothing else: it is never
 * read again once a question has a rating row.
 */
export function seedRating(seedTier: number): number {
	return BASE_RATING + (seedTier - 3) * 100;
}

/** How a question stands, in one scope. */
export interface RatingState {
	rating: number;
	plays: number;
	/** Consecutive identical outcomes. 0 before the first attempt. */
	run: number;
	/** Which outcome the run is of. Null when there is no run. */
	runResult: string | null;
}

export type AttemptResult = 'got' | 'missed';

export interface Drift {
	next: RatingState;
	/** Signed, and already clamped — so a caller reporting it is reporting what
	 *  actually happened rather than what the formula wanted. */
	delta: number;
}

/** The starting state of a question nothing has recorded yet. */
export const initialState = (rating: number): RatingState => ({
	rating,
	plays: 0,
	run: 0,
	runResult: null,
});

/**
 * Confidence in the current rating, as a K-factor.
 *
 * Falls off with play count so twenty plays of evidence are not overturned by
 * one. Hyperbolic rather than stepped: a step schedule makes a question's
 * sensitivity jump at an arbitrary play count, which shows up as a rating that
 * suddenly stops moving for no reason a reader could see.
 */
export function confidence(plays: number): number {
	return K_MAX / (1 + Math.max(0, plays) / K_HALF_LIFE);
}

/** The streak multiplier for a run of `run` identical outcomes. */
export function streakMultiplier(run: number): number {
	return Math.min(STREAK_CAP, 1 + STREAK_STEP * (Math.max(1, run) - 1));
}

/**
 * The chance this question beats the field.
 *
 * "Beating" you means you missed it. A question rated far above the field is
 * expected to win, so winning tells us almost nothing and losing tells us a
 * great deal — which is exactly the asymmetry that keeps ratings from running
 * away from the pack.
 */
export function expectedWin(rating: number, poolMean: number): number {
	return 1 / (1 + Math.pow(10, (poolMean - rating) / SCALE));
}

/**
 * Apply one attempt.
 *
 * The run is advanced BEFORE the multiplier is taken, so the attempt that
 * makes it a run of three is itself scaled by three-in-a-row. Scoring the
 * outcome at the previous run length would always lag the streak by one, which
 * on a two-attempt streak means the multiplier never applies at all.
 */
export function drift(current: RatingState, poolMean: number, result: AttemptResult): Drift {
	const run = current.runResult === result ? current.run + 1 : 1;

	const expected = expectedWin(current.rating, poolMean);
	const actual = result === 'missed' ? 1 : 0;
	const move = confidence(current.plays) * streakMultiplier(run) * (actual - expected);

	const next = Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(current.rating + move)));

	return {
		next: { rating: next, plays: current.plays + 1, run, runResult: result },
		delta: next - current.rating,
	};
}

/**
 * The field a question is measured against.
 *
 * The mean over EVERY question in the set, including ones nobody has played —
 * those sit at their seed, which is a real estimate and not a missing value.
 * Averaging only the played ones would make the field lurch every time a new
 * question was first attempted, and every rating in the set would move because
 * of it.
 */
export function poolMean(ratings: number[]): number {
	if (ratings.length === 0) return BASE_RATING;
	return ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
}
