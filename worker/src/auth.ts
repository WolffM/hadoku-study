/**
 * Who may do what.
 *
 * Two independent facts have to hold before a caller may own or modify a set:
 *
 *   1. TIER — friend+ (`public < friend < service < wife < admin`). Always via
 *      `tierAtLeast`, NEVER `userType === 'friend'`: an equality check silently
 *      locks out every tier above the one named, and that exact bug has shipped
 *      twice in this ecosystem.
 *   2. IDENTITY — a registry `userId`, which edge-router injects as X-User-Id.
 *      Rows bind to it because a key can rotate and the userId does not.
 *
 * They are separate because they fail separately, and the difference is worth
 * telling apart: a public caller has no business writing, while a friend whose
 * request arrived without a userId means the edge route is missing
 * `injectUserId` — an operator bug that would otherwise read to the user as a
 * mysterious permission denial.
 */

import { tierAtLeast, type HadokuAuthContext } from '@wolffm/worker-utils';
import type { Context } from 'hono';
import { userIdOf } from './db.js';

export type WriterResolution =
	{ ok: true; userId: string } | { ok: false; status: 403; message: string };

export function resolveWriter(c: Context): WriterResolution {
	const auth = c.get('authContext') as HadokuAuthContext | undefined;

	if (!tierAtLeast(auth, 'friend')) {
		return {
			ok: false,
			status: 403,
			message: 'Creating or modifying a set requires friend access.',
		};
	}

	const userId = userIdOf(c.req.raw);
	if (!userId) {
		return {
			ok: false,
			status: 403,
			message:
				'No user identity on this request. The edge route must inject X-User-Id for /study/api.',
		};
	}

	return { ok: true, userId };
}

/**
 * The reader's identity, or null when signed out.
 *
 * Never gates: reading a PUBLISHED set is public by design, and a private set
 * is filtered out by the SQL in `loadSetForRead` rather than by a tier check.
 * A signed-out caller simply owns nothing, so nothing private matches.
 */
export function readerUserId(c: Context): string | null {
	return userIdOf(c.req.raw);
}
