/**
 * How a caller proves who they are — declared once, so the OpenAPI spec says
 * it out loud.
 *
 * The spec is the contract an agent reads before its first request, and one
 * that never mentions authentication leaves the reader to guess. Every write
 * here is friend+, so a spec without these schemes describes an API that
 * appears to 403 for no stated reason.
 *
 * Neither header is read by this worker. Both are consumed by edge-router,
 * which resolves either one to a registry user and re-stamps the request with
 * the sealed `X-User-Id` / `X-Hadoku-Tier` pair these routes actually gate on.
 * They are documented at the edge's granularity because that is where a caller
 * has to supply them.
 */

/**
 * One OpenAPI security requirement: scheme name -> required scopes.
 *
 * Annotated rather than inferred. A bare array literal widens to a UNION of
 * object types with optional-undefined members, which does not satisfy
 * OpenAPI's `{ [name: string]: string[] }` index signature, and the resulting
 * error surfaces as unrelated "unsafe assignment" noise on `c.req.valid()`
 * calls three files away.
 */
type SecurityRequirement = Record<string, string[]>;

/** OpenAPI `components.securitySchemes`, registered in `index.ts`. */
export const SECURITY_SCHEMES = {
	UserKey: {
		type: 'apiKey',
		in: 'header',
		name: 'X-User-Key',
		description:
			'A hadoku key, for scripts, agents and anything without a browser session. edge-router resolves it to a registry user and tier. This is the channel to use from curl or an SDK.',
	},
	SessionId: {
		type: 'apiKey',
		in: 'header',
		name: 'X-Session-Id',
		description:
			'A browser session id. The web app sends the session cookie instead and only falls back to this header where cookies are blocked cross-origin.',
	},
} as const;

/**
 * Applied to operations that need an identity.
 *
 * Two entries, not one object with two keys: in OpenAPI a list of requirement
 * objects is OR, while two keys inside ONE object is AND. Merging them would
 * tell every generated client to send both headers on every call.
 */
export const AUTHENTICATED: SecurityRequirement[] = [{ UserKey: [] }, { SessionId: [] }];

/**
 * Applied to operations that are readable signed-out.
 *
 * An explicit empty list is not the same as saying nothing: it marks the
 * operation as genuinely public, where an absent `security` would instead
 * inherit whatever document-level default is set later. Publishing exists so
 * these paths work with no account, and the spec should assert that rather
 * than leave it to be inferred.
 */
export const OPTIONAL_AUTH: SecurityRequirement[] = [{}, { UserKey: [] }, { SessionId: [] }];
