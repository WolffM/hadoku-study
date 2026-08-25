/**
 * Who a set can be handed to.
 *
 * A userId is an OPAQUE STRING, not a UUID. This asserted the UUID shape for
 * one release and it was wrong — `registry.ts` mints a UUID only for records
 * it creates, so an identity seeded any other way keeps whatever id it was
 * given, and `hadoku` is a real one. The regex made a legitimate owner
 * unassignable, which is a worse failure than the typo it was guarding
 * against.
 *
 * What is checked now is what a STORE needs, not what a format implies.
 */

import { describe, expect, it } from 'vitest';
import { TransferOwnerInputSchema } from './schemas.js';

const parse = (body: unknown) => TransferOwnerInputSchema.safeParse(body);

describe('naming a recipient', () => {
	it('takes a plain-word userId', () => {
		// The case the UUID regex refused. This is a real identity.
		const ok = parse({ userId: 'hadoku' });
		expect(ok.success).toBe(true);
		expect(ok.success && ok.data.userId).toBe('hadoku');
	});

	it('takes a UUID too, since that is what new records get', () => {
		expect(parse({ userId: '2fbe7e55-edb2-49b9-bd15-8c1fbd1b5a90' }).success).toBe(true);
	});

	it('takes an empty body, which means "give it to me"', () => {
		// How an admin adopts a set whose owner no longer holds a key, without
		// having to look up their own id first.
		const ok = parse({});
		expect(ok.success).toBe(true);
		expect(ok.success && ok.data.userId).toBeUndefined();
	});

	it('trims, so an id copied with padding still lands on the right owner', () => {
		const ok = parse({ userId: '  hadoku  ' });
		expect(ok.success && ok.data.userId).toBe('hadoku');
	});

	it('refuses what a store cannot use', () => {
		// Not a format opinion — these are the values that would assign the set
		// to an owner nobody can authenticate as.
		for (const userId of ['', '   ', 'two words', 'has\nnewline', 'x'.repeat(200)]) {
			expect(parse({ userId }).success, JSON.stringify(userId)).toBe(false);
		}
	});

	it('says where to find one', () => {
		const bad = parse({ userId: 'two words' });
		expect(bad.success).toBe(false);
		expect(bad.success === false && JSON.stringify(bad.error.issues)).toContain('whoami');
	});
});
