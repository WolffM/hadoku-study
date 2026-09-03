/**
 * Who may write a set they do not own.
 *
 * Owner-only made the API unusable for the work it exists to support: an agent
 * restructuring a set holds a service key and is not the owner, so every write
 * came back as a 404 indistinguishable from "no such set".
 *
 * The ladder is `public < friend < service < wife < admin`. Every case below
 * is here because an equality check would get it wrong — and an equality check
 * on tier has shipped twice in this ecosystem.
 */

import { describe, expect, it } from 'vitest';
import type { HadokuAuthContext } from '@wolffm/worker-utils';
import { mayWriteAnySet } from './sets.js';

const at = (userType: string) => ({ userType }) as unknown as HadokuAuthContext;

describe('mayWriteAnySet', () => {
	it('admits service, the case this exists for', () => {
		expect(mayWriteAnySet(at('service'))).toBe(true);
	});

	it('admits every tier ABOVE service, which equality would have locked out', () => {
		expect(mayWriteAnySet(at('wife'))).toBe(true);
		expect(mayWriteAnySet(at('admin'))).toBe(true);
	});

	it('holds a friend to the sets they own', () => {
		// Friend is a real person with their own sets. They keep the owner
		// check; nothing about this change gives one friend another's set.
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
