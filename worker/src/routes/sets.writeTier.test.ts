/**
 * Who may write a set they do not own: the owner, or an admin.
 *
 * Owner-only made the API unusable for the work it exists to support: an agent
 * restructuring a set is not the owner. Service tier admitted that agent, and
 * with it every service key in the fleet; admin admits the operator's agents.
 *
 * The ladder is `public < friend < service < wife < admin`.
 */

import { describe, expect, it } from 'vitest';
import type { HadokuAuthContext } from '@wolffm/worker-utils';
import { mayWriteAnySet } from './sets.js';

const at = (userType: string) => ({ userType }) as unknown as HadokuAuthContext;

describe('mayWriteAnySet', () => {
	it('admits admin, the case this exists for', () => {
		expect(mayWriteAnySet(at('admin'))).toBe(true);
	});

	it('holds a service key to the sets it owns', () => {
		// A service key names the whole fleet; it does not get everyone's sets.
		expect(mayWriteAnySet(at('service'))).toBe(false);
	});

	it('holds wife and friend to the sets they own', () => {
		expect(mayWriteAnySet(at('wife'))).toBe(false);
		expect(mayWriteAnySet(at('friend'))).toBe(false);
	});

	it('refuses public, and refuses no auth at all', () => {
		expect(mayWriteAnySet(at('public'))).toBe(false);
		expect(mayWriteAnySet(undefined)).toBe(false);
	});

	it('refuses a tier this build has never heard of', () => {
		// Fail closed: an older bundle meeting a newer tier name must not admit
		// it by accident.
		expect(mayWriteAnySet(at('archduke'))).toBe(false);
	});
});
