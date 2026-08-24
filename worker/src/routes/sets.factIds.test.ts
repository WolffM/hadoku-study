/**
 * Saving a set must not throw away what it has learned.
 *
 * A save replaces a set's facts WHOLESALE — one DELETE, then INSERTs. In v1
 * that was free, because nothing outside the set referred to a card by id.
 * Ratings and attempts changed that: both hang off `fact_id`, so re-minting an
 * id on save deletes a question's entire history with no error, no warning and
 * nothing in the response to notice. These tests are the only thing standing
 * between "fixed a typo" and "lost a month of play data".
 */

import { describe, expect, it } from 'vitest';
import { resolveFactIds } from './sets.js';

const fact = (id?: string) => ({ id, slots: { prompt: 'a', answer: 'b' } });

describe('resolveFactIds', () => {
	it('keeps an id the set already owns', () => {
		const ids = resolveFactIds([fact('keep-me')], new Set(['keep-me']));
		expect(ids).toEqual(['keep-me']);
	});

	it('mints one for a fact that has never been saved', () => {
		const [id] = resolveFactIds([fact()], new Set(['other']));
		expect(id).toBeTruthy();
		expect(id).not.toBe('other');
	});

	it('refuses an id belonging to a different set', () => {
		// Otherwise a hand-edited file could adopt another set's rating history
		// simply by naming its ids.
		const [id] = resolveFactIds([fact('someone-elses')], new Set(['mine']));
		expect(id).not.toBe('someone-elses');
	});

	it('gives the second claimant on a duplicated id a fresh one', () => {
		// Two facts cannot share a primary key. Letting both through would make
		// the INSERT fail and take the whole save with it.
		const ids = resolveFactIds([fact('dupe'), fact('dupe')], new Set(['dupe']));
		expect(ids[0]).toBe('dupe');
		expect(ids[1]).not.toBe('dupe');
		expect(new Set(ids).size).toBe(2);
	});

	it('keeps positions aligned when only some facts are new', () => {
		// The returned array is indexed by position, so a mint in the middle
		// must not shift the ids of the facts around it.
		const ids = resolveFactIds([fact('a'), fact(), fact('b')], new Set(['a', 'b']));
		expect(ids[0]).toBe('a');
		expect(ids[2]).toBe('b');
		expect(ids[1]).not.toBe('a');
		expect(ids[1]).not.toBe('b');
	});

	it('survives a whole set being re-imported unchanged', () => {
		const existing = new Set(['f1', 'f2', 'f3']);
		expect(resolveFactIds([fact('f1'), fact('f2'), fact('f3')], existing)).toEqual([
			'f1',
			'f2',
			'f3',
		]);
	});

	it('mints for every fact when a file carries no ids at all', () => {
		// A hand-written file, or a v1 export. Nothing to preserve, so nothing
		// is claimed — but the save still has to work.
		const ids = resolveFactIds([fact(), fact()], new Set(['f1']));
		expect(new Set(ids).size).toBe(2);
		expect(ids).not.toContain('f1');
	});
});
