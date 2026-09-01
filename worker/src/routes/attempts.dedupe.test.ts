/**
 * Recording an answer twice must not count it twice.
 *
 * The client holds every answer until the server confirms it, so a request
 * whose reply was lost is sent again in full — that is the design, not a
 * fault, and it is what stops a killed tab costing a graded answer. The price
 * is that the ledger sees repeats, and it has to absorb them silently.
 *
 * Counting one twice would be worse than losing it. A duplicate row is at
 * least visible; a rating moved twice for one answer is a number nobody can
 * tell from a real one, in the ledger the whole system trusts.
 */

import { describe, expect, it } from 'vitest';
import { unseenAnswers } from './attempts.js';

const answer = (attemptId?: string, factId = 'f1') => ({
	attemptId,
	factId,
	variantKey: 'answer<prompt>',
	result: 'got' as const,
});

describe('unseenAnswers', () => {
	it('passes through a batch the ledger has never seen', () => {
		const { fresh, skipped } = unseenAnswers([answer('a1'), answer('a2')], new Set());
		expect(fresh.map((entry) => entry.attemptId)).toEqual(['a1', 'a2']);
		expect(skipped).toBe(0);
	});

	it('skips an answer the ledger already holds', () => {
		// The confirmed-delivery retry: the write landed, the reply did not.
		const { fresh, skipped } = unseenAnswers([answer('a1')], new Set(['a1']));
		expect(fresh).toEqual([]);
		expect(skipped).toBe(1);
	});

	it('keeps the new answers in a batch that is only PARTLY a repeat', () => {
		// A flush carries held answers alongside the one just graded, so the
		// common retry is a batch where the front is known and the tail is not.
		const { fresh, skipped } = unseenAnswers(
			[answer('a1'), answer('a2'), answer('a3')],
			new Set(['a1', 'a2'])
		);
		expect(fresh.map((entry) => entry.attemptId)).toEqual(['a3']);
		expect(skipped).toBe(2);
	});

	it('dedupes an id repeated WITHIN one batch', () => {
		// Two concurrent flushes of one outbox put the same id in one request.
		const { fresh, skipped } = unseenAnswers([answer('a1'), answer('a1')], new Set());
		expect(fresh).toHaveLength(1);
		expect(skipped).toBe(1);
	});

	it('treats an answer with no id as fresh, never as a duplicate', () => {
		// A bundle older than the idempotency key. It cannot be deduped, and
		// dropping it would lose a real answer to a version skew.
		const { fresh, skipped } = unseenAnswers([answer(undefined), answer(undefined)], new Set());
		expect(fresh).toHaveLength(2);
		expect(skipped).toBe(0);
	});

	it('does not mutate the set it was given', () => {
		// The caller built it from a query; a function that quietly grew it
		// would make the second call in a request behave differently.
		const held = new Set(['a1']);
		unseenAnswers([answer('a2')], held);
		expect([...held]).toEqual(['a1']);
	});

	it('counts every repeat, so a rate that stops falling is visible', () => {
		const { skipped } = unseenAnswers([answer('a1'), answer('a1'), answer('a1')], new Set(['a1']));
		expect(skipped).toBe(3);
	});
});
