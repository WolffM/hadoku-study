/**
 * The deck summary is what makes "is anyone actually using this" answerable
 * from the log, so its arithmetic is pinned rather than eyeballed.
 */

import { describe, expect, it } from 'vitest';
import { deckShape } from './telemetry.js';

const plain = { attrs: null };
const clue = { attrs: { board: { category: 'Places', difficulty: 1 } } };

describe('deckShape', () => {
	it('counts a plain deck as having no clues and no games', () => {
		expect(deckShape([plain, plain])).toEqual({ cards: 2, boardClues: 0, games: [] });
	});

	it('counts board clues separately from cards', () => {
		expect(deckShape([clue, clue, plain])).toEqual({
			cards: 3,
			boardClues: 2,
			games: ['board'],
		});
	});

	it('names every game present, so a new mode shows up without code changes', () => {
		// The point of the attrs bag is that a game can exist before the server
		// knows about it. The log should say so rather than reporting only the
		// namespaces this build happens to recognise.
		const shape = deckShape([clue, { attrs: { nameThatMap: { region: 'Maguuma' } } }]);
		expect(shape.games).toEqual(['board', 'nameThatMap']);
		expect(shape.boardClues).toBe(1);
	});

	it('handles an empty deck', () => {
		expect(deckShape([])).toEqual({ cards: 0, boardClues: 0, games: [] });
	});

	it('treats a card with an empty bag as untagged', () => {
		expect(deckShape([{ attrs: {} }])).toEqual({ cards: 1, boardClues: 0, games: [] });
	});
});
