/**
 * The deck summary is what makes "is anyone actually using this" answerable
 * from the log, so its arithmetic is pinned rather than eyeballed.
 */

import { describe, expect, it } from 'vitest';
import { deckShape } from './telemetry.js';

/** A migrated v1 card: two slots, one question, no game has claimed it. */
const plain = { slots: { prompt: 'кот', answer: 'cat' }, variants: [{}], attrs: null };
/** An authored fact: four slots asked three ways, sitting on a board. */
const authored = {
	slots: { who: 'Luther', what: 'refused to recant', where: 'Worms', when: '1521' },
	variants: [{}, {}, {}],
	attrs: { board: { category: 'Places' } },
};

describe('deckShape', () => {
	it('counts facts, the questions they make, and the slots behind them', () => {
		expect(deckShape([plain, plain])).toEqual({
			facts: 2,
			variants: 2,
			slots: 4,
			games: [],
		});
	});

	it('separates facts from the questions they expand into', () => {
		// The ratio is the whole point: a set imported straight off v1 sits at
		// 1.0 until somebody adds slots to it, and the fact count alone cannot
		// show that.
		expect(deckShape([authored, plain])).toEqual({
			facts: 2,
			variants: 4,
			slots: 6,
			games: ['board'],
		});
	});

	it('names every game present, so a new mode shows up without code changes', () => {
		// The point of the attrs bag is that a game can exist before the server
		// knows about it. The log should say so rather than reporting only the
		// namespaces this build happens to recognise.
		const shape = deckShape([
			authored,
			{ slots: { a: '1', b: '2' }, variants: [{}], attrs: { nameThatMap: { region: 'Maguuma' } } },
		]);
		expect(shape.games).toEqual(['board', 'nameThatMap']);
	});

	it('handles an empty set', () => {
		expect(deckShape([])).toEqual({ facts: 0, variants: 0, slots: 0, games: [] });
	});

	it('treats a fact with an empty bag as unclaimed', () => {
		expect(deckShape([{ slots: { a: '1', b: '2' }, variants: [{}], attrs: {} }])).toEqual({
			facts: 1,
			variants: 1,
			slots: 2,
			games: [],
		});
	});
});
