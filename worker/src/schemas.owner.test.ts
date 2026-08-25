/**
 * Who a set can be handed to.
 *
 * The UUID check is not cosmetic: a typo assigns the set to a userId nobody
 * holds a key for, and it becomes unreachable through the API entirely. An
 * admin can still rescue it, but the whole point is not to need rescuing.
 */

import { describe, expect, it } from 'vitest';
import { TransferOwnerInputSchema } from './schemas.js';

const parse = (body: unknown) => TransferOwnerInputSchema.safeParse(body);

describe('naming a recipient', () => {
	it('takes a real registry userId', () => {
		const ok = parse({ userId: '2fbe7e55-edb2-49b9-bd15-8c1fbd1b5a90' });
		expect(ok.success).toBe(true);
	});

	it('takes an empty body, which means "give it to me"', () => {
		// How an admin adopts a set whose owner no longer holds a key, without
		// having to look up their own id first.
		const ok = parse({});
		expect(ok.success).toBe(true);
		expect(ok.success && ok.data.userId).toBeUndefined();
	});

	it('refuses anything that is not a UUID', () => {
		for (const userId of [
			'',
			'me',
			'2fbe7e55edb249b9bd1550a8b9a90',
			'2fbe7e55-edb2-49b9-bd15-8c1fbd1b5a9', // one short
			'2fbe7e55-edb2-49b9-bd15-8c1fbd1b5a90x',
			'  2fbe7e55-edb2-49b9-bd15-8c1fbd1b5a90  ',
		]) {
			expect(parse({ userId }).success, JSON.stringify(userId)).toBe(false);
		}
	});

	it('says where to find one', () => {
		const bad = parse({ userId: 'me' });
		expect(bad.success).toBe(false);
		expect(bad.success === false && JSON.stringify(bad.error.issues)).toContain('whoami');
	});
});
