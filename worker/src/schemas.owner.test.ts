/**
 * Who a set can be handed to — the permanent regression for the 2026-08-25
 * incident.
 *
 * A file of this name used to assert the OPPOSITE: that `{userId: 'hadoku'}`
 * was a valid recipient, with the comment "This is a real identity." It is not.
 * `hadoku` is a DISPLAY NAME — the registry row is `Hadoku` and its userId is
 * `de5c2a05-…` — and accepting it put a display name in `sets.owner_user_id`
 * and stranded a published set for two days.
 *
 * The lesson is not "check the shape". A UUID regex was the first fix and it
 * was the wrong axis in the other direction: it would wave through a
 * well-formed UUID belonging to nobody, and it refused a real id. The rule is
 * NEVER STORE AN IDENTIFIER YOU DID NOT RESOLVE, so the schema does not accept
 * an identifier at all — only a NAME, which the worker resolves.
 *
 * See docs/architecture/IDENTITY_MODEL.md in hadoku_site.
 */

import { describe, expect, it } from 'vitest';
import { TransferOwnerInputSchema } from './schemas.js';

const parse = (body: unknown) => TransferOwnerInputSchema.safeParse(body);

describe('naming a recipient', () => {
	it('REJECTS a userId — the exact body from the incident', () => {
		// Rejected rather than stripped. Stripping would turn this into an empty
		// body, i.e. a silent SELF-CLAIM: the set would go to the caller instead
		// of the person they named, and nothing would say so.
		expect(parse({ userId: 'hadoku' }).success).toBe(false);
		expect(parse({ name: 'thyeggman', userId: 'hadoku' }).success).toBe(false);
	});

	it('rejects a well-formed UUID too — a regex would have waved it through', () => {
		// The case the first fix could not catch: correctly shaped, belongs to
		// nobody. Only a registry lookup rejects both, which is why the schema
		// takes a name and the handler does the resolving.
		expect(parse({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }).success).toBe(false);
	});

	it('takes a display name', () => {
		const out = parse({ name: 'thyeggman' });
		expect(out.success && out.data.name).toBe('thyeggman');
	});

	it('trims, so a name copied with padding still resolves', () => {
		expect(
			parse({ name: '  thyeggman  ' }).success && parse({ name: '  thyeggman  ' })
		).toBeTruthy();
		const out = parse({ name: '  thyeggman  ' });
		expect(out.success && out.data.name).toBe('thyeggman');
	});

	it('takes an empty body, which means "give it to me"', () => {
		// How an admin adopts a set whose owner no longer holds a key, without
		// having to look up their own id first. This is the branch that
		// RECOVERED the incident, and it is unchanged.
		const out = parse({});
		expect(out.success).toBe(true);
		expect(out.success && out.data.name).toBeUndefined();
	});

	it('refuses a name a registry lookup could never match', () => {
		for (const name of ['', '   ', 'x'.repeat(400)]) {
			expect(parse({ name }).success, JSON.stringify(name)).toBe(false);
		}
	});
});
