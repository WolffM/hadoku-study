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
	 * D1 binding — sets, cards and per-user resume bookmarks.
	 *
	 * REQUIRED, and deliberately not optional: every route below the health
	 * check reads or writes it, so a deploy without the binding is broken, not
	 * degraded. Typing it optional would only move the failure from "deploy
	 * refuses" to "every request 500s at runtime with a null deref".
	 */
	STUDY_DB: D1Database;
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
	title: string;
	description: string | null;
	published_at: number | null;
	created_at: number;
	updated_at: number;
}

export interface CardRow {
	id: string;
	set_id: string;
	front: string;
	back: string;
	position: number;
}

/**
 * A resume bookmark for ONE pass over a set — NOT a scheduling record.
 *
 * v1 is a plain drill: you walk the set, self-grade each card, and the pass
 * ends when the queue empties. This row exists so that a lock screen, a
 * rotate, or picking the phone back up an hour later resumes where you were.
 * It is deleted when the pass completes.
 *
 * `results` is a JSON map of cardId -> RESULT STRING, not a boolean. v2 judges
 * typed answers with an LLM and will need a third verdict; a `correct BOOLEAN`
 * column would have to be migrated, a 'got' | 'missed' string only has to gain
 * a member.
 */
export interface ProgressRow {
	user_id: string;
	set_id: string;
	queue: string;
	results: string;
	updated_at: number;
}
