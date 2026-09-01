/**
 * Environment bindings for Study Worker
 */
export interface AppEnv {
	// ============================================================================
	// Authentication (verified by @wolffm/worker-utils createEdgeAuth)
	// ============================================================================

	/**
	 * Shared edge-provenance secret. edge-router resolves the caller's key to a
	 * tier and stamps X-Hadoku-Tier; createEdgeAuth verifies the accompanying
	 * X-Edge-Auth against this secret and trusts the tier. A worker never holds
	 * or validates user keys itself — the key arrays this used to list were
	 * retired 2026-07-26 (see CLAUDE.md "Auth Keys").
	 */
	EDGE_AUTH_SECRET?: string;

	// ============================================================================
	// Service-specific secrets
	// ============================================================================

	/** API key for service-to-service calls */
	STUDY_API_KEY?: string;

	// ============================================================================
	// Database
	// ============================================================================

	/**
	 * D1 binding — sets, facts, ratings, attempts and resume bookmarks.
	 *
	 * REQUIRED, and deliberately not optional: every route below the health
	 * check reads or writes it, so a deploy without the binding is broken, not
	 * degraded. Typing it optional would only move the failure from "deploy
	 * refuses" to "every request 500s at runtime with a null deref".
	 */
	STUDY_DB: D1Database;

	/**
	 * The read-only key registry (`key:{rawKey}` → registry row), the same
	 * namespace edge-router owns and task-api / prefs-api / watchparty-stats-api
	 * bind.
	 *
	 * Needed for exactly one thing: `POST /sets/{id}/owner` takes a display
	 * NAME and has to resolve it to the userId ownership is keyed on (R4). It
	 * used to take a `userId` straight out of the request body and store it
	 * unlooked-up, which on 2026-08-25 put a display name in
	 * `sets.owner_user_id` and stranded a published set for two days.
	 *
	 * A resolve genuinely needs the registry: the shared person-picker
	 * (`GET /session/users/search`) returns names and tiers and DELIBERATELY no
	 * userId, because a selector that hands out ids invites the caller to post
	 * one back — the shape R5 forbids. So the binding is the honest way to do
	 * this, and it is read-only.
	 *
	 * Optional so a deploy without it degrades to a clear 400 on that one
	 * endpoint rather than failing to boot.
	 *
	 * See docs/architecture/IDENTITY_MODEL.md in hadoku_site.
	 */
	SESSIONS_KV?: KVNamespace;
}

/**
 * A flashcard set, as stored.
 *
 * `published_at` doubles as the published FLAG and the timestamp — NULL means
 * private. Publishing is a per-set flag, never a second copy of the rows, so
 * an edit to a published set is live immediately and there is no draft/live
 * divergence to reconcile.
 */
export interface SetRow {
	id: string;
	owner_user_id: string;
	/** JSON array of {name,label,ask[]}, or NULL for a set declaring none. */
	archetypes: string | null;
	title: string;
	description: string | null;
	published_at: number | null;
	created_at: number;
	updated_at: number;
}

/**
 * A fact, as stored.
 *
 * `slots` and `questions` are JSON STRINGS here and objects nowhere below the
 * handler edge — parsed once on read, serialized once on write, never touched
 * raw in between.
 *
 * There is no `variants` column and no variants table. Variants are expanded
 * on read by `expandFact`, because their keys are what ratings hang off: a
 * stored copy would be a second answer to "what questions does this fact ask",
 * free to disagree with the slots it was derived from the moment either is
 * edited.
 */
export interface FactRow {
	id: string;
	set_id: string;
	position: number;
	/**
	 * Which archetype this fact belongs to, by name, or NULL for the implicit
	 * one. Exactly one — a fact in two could be drawn into two board columns,
	 * which is the scattering archetypes exist to end.
	 */
	archetype: string | null;
	/** JSON object, slot name -> value. Insertion order is the author's order,
	 *  and is preserved through JSON.parse, so it is also display order. */
	slots: string;
	/** JSON array of question declarations, or NULL for "ask each slot in turn,
	 *  giving all the others". */
	questions: string | null;
	/** The "why" shown after the answer — context, not the answer itself.
	 *  A real column because every mode wants it. */
	detail: string | null;
	/**
	 * Per-game attributes as a JSON STRING, keyed by game id — or NULL on a
	 * fact no game has claimed.
	 *
	 * Narrower than it was in v1: `difficulty` moved out to the variant's
	 * `seedTier` in 0003, because a tier is a rating concept rather than a
	 * board one. What stays here is genuinely board-specific, like a column
	 * label.
	 */
	attrs: string | null;
}

/**
 * How one question stands, in one scope.
 *
 * The same shape backs `variant_ratings` (everybody's) and
 * `user_variant_ratings` (one reader's), because the arithmetic is identical
 * and only the population differs. Two row types would be two places to change
 * when the formula does.
 *
 * `user_id` is present only on the per-user table, which is why it is optional
 * here rather than modelled as a separate interface.
 */
export interface RatingRow {
	user_id?: string;
	fact_id: string;
	variant_key: string;
	rating: number;
	plays: number;
	/** Consecutive identical outcomes. On the GLOBAL table this counts across
	 *  readers, which is meaningful in its own right: three people in a row
	 *  missing a question says something a single reader's run does not. */
	run: number;
	run_result: string | null;
	updated_at: number;
}

/**
 * A resume bookmark for ONE pass over a set — NOT a scheduling record.
 *
 * A drill is a plain walk: you take the set's questions in turn, self-grade
 * each, and the pass ends when the queue empties. This row exists so that a
 * lock screen, a rotate, or picking the phone back up an hour later resumes
 * where you were. It is deleted when the pass completes.
 *
 * `queue` and the keys of `results` are VARIANT ids — `factId:variantKey` —
 * because a pass walks questions, and two questions over one fact are two
 * separate things to get right.
 *
 * `results` maps to a RESULT STRING rather than a boolean. Grading is
 * self-reported and stays that way, but a third verdict is a widened union
 * where a `correct BOOLEAN` column would be a migration — and the same
 * reasoning governs `attempts.result`, which is the row that actually matters
 * now.
 */
export interface ProgressRow {
	user_id: string;
	set_id: string;
	queue: string;
	results: string;
	updated_at: number;
}
