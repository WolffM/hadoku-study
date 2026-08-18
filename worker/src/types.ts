/**
 * Environment bindings for Study Worker
 *
 * This interface defines all the bindings and secrets available to your worker.
 * Update this based on what your app needs (D1, KV, Durable Objects, etc.)
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

	/** API key for service-to-service calls (e.g., from trader-api) */
	STUDY_API_KEY?: string;

	// ============================================================================
	// Optional: Database Bindings (uncomment if needed)
	// ============================================================================

	// /** D1 Database binding - requires [[d1_databases]] in wrangler.toml */
	// STUDY_DB?: D1Database;

	// /** KV Namespace binding - requires [[kv_namespaces]] in wrangler.toml */
	// STUDY_KV?: KVNamespace;

	// ============================================================================
	// Optional: External Service URLs
	// ============================================================================

	// /** URL to external service tunnel (e.g., local Python service) */
	// TUNNEL_URL?: string;
}
