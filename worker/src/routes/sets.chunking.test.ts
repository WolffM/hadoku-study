/**
 * The fact INSERT has to fit inside D1's bound-parameter ceiling.
 *
 * This is a regression test for a bug that shipped and hid. The file claimed
 * SQLite's 999-parameter limit and chunked at 50 rows; D1's real limit is 100,
 * so writing any set past 20 cards 500d. Nothing caught it because no set that
 * large existed yet — the first 25-clue board found it on its first import.
 *
 * The failure mode is what makes this worth pinning: it is invisible in every
 * small set, and it surfaces as a bare 500 with no hint at the cause. Adding a
 * column silently lowers the threshold, so the arithmetic is asserted rather
 * than trusted to whoever edits the INSERT next.
 */

import { describe, expect, it } from 'vitest';
import { D1_MAX_BOUND_PARAMS, FACT_COLUMNS, INSERT_CHUNK } from './sets.js';

describe('fact insert chunking', () => {
	it('never binds more parameters than D1 accepts', () => {
		expect(INSERT_CHUNK * FACT_COLUMNS).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
	});

	it('uses the ceiling it is given, rather than being needlessly small', () => {
		// One row short of the limit would double the statement count on a large
		// set for no reason; this pins the chunk as the largest that fits.
		expect((INSERT_CHUNK + 1) * FACT_COLUMNS).toBeGreaterThan(D1_MAX_BOUND_PARAMS);
	});

	it('still writes a full-size set in a sane number of statements', () => {
		// 500 facts is MAX_FACTS_PER_SET. One statement per fact would put the
		// batch's size in the hands of whoever pasted the set.
		const statements = Math.ceil(500 / INSERT_CHUNK);
		expect(statements).toBeLessThan(50);
	});

	it('holds for the board that found the bug', () => {
		// 25 clues at 7 columns is 175 parameters in one statement — the exact
		// shape that 500d in production on 2026-08-21. The column count moved
		// from cards to facts and the arithmetic still has to hold.
		const chunks = Math.ceil(25 / INSERT_CHUNK);
		expect(chunks).toBeGreaterThan(1);
		for (let i = 0; i < chunks; i += 1) {
			const rows = Math.min(INSERT_CHUNK, 25 - i * INSERT_CHUNK);
			expect(rows * FACT_COLUMNS).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
		}
	});
});
