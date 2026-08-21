/**
 * The export IS the import.
 *
 * A set travels as one file only because what `GET /sets/{id}` returns parses
 * as a create/replace body without editing — which holds because zod STRIPS
 * unknown keys instead of rejecting them. That is a default, not a decision
 * anyone wrote down, so one `.strict()` added for tidiness would break every
 * import with a validation error and no other signal. These tests are the
 * signal.
 */

import { describe, expect, it } from 'vitest';
import { CreateSetInputSchema, ReplaceSetInputSchema, SetDetailSchema } from './schemas.js';

/** Exactly the shape `GET /sets/{id}` puts in `data.set`. */
const exported = SetDetailSchema.parse({
	id: 'qvv7k2mfjxtd',
	title: 'Russian — animals',
	description: 'First 40 nouns',
	published: true,
	cardCount: 2,
	isOwner: true,
	createdAt: '2026-08-18T00:00:00.000Z',
	updatedAt: '2026-08-18T00:00:00.000Z',
	cards: [
		{ id: 'card-one', front: 'кот', back: 'cat' },
		{ id: 'card-two', front: 'собака', back: 'dog' },
	],
});

describe('an exported set re-imports as a new set', () => {
	const reimported = CreateSetInputSchema.parse(exported);

	it('keeps the content', () => {
		expect(reimported.title).toBe('Russian — animals');
		expect(reimported.description).toBe('First 40 nouns');
		expect(reimported.cards).toEqual([
			{ front: 'кот', back: 'cat' },
			{ front: 'собака', back: 'dog' },
		]);
	});

	it('keeps publication, so the round trip loses nothing', () => {
		expect(reimported.published).toBe(true);
	});

	it('drops every server-owned field rather than rejecting it', () => {
		expect(Object.keys(reimported).sort()).toEqual(['cards', 'description', 'published', 'title']);
		expect(reimported.cards?.[0]).not.toHaveProperty('id');
	});
});

describe('an exported set re-imports over an existing set', () => {
	it('parses as a PUT body unchanged', () => {
		const replaced = ReplaceSetInputSchema.parse(exported);
		expect(replaced.title).toBe('Russian — animals');
		expect(replaced.cards).toHaveLength(2);
		expect(replaced.published).toBe(true);
	});

	it('requires cards, because a PUT states the whole set', () => {
		const { cards: _cards, ...withoutCards } = exported;
		expect(ReplaceSetInputSchema.safeParse(withoutCards).success).toBe(false);
	});

	it('accepts a hand-written file with only a title and cards', () => {
		const minimal = ReplaceSetInputSchema.parse({
			title: 'Hand written',
			cards: [{ front: 'a', back: 'b' }],
		});
		// Undefined, NOT false: on PUT that means "leave visibility alone", so a
		// minimal file cannot silently unshare a published set.
		expect(minimal.published).toBeUndefined();
	});
});

describe('game attributes round-trip alongside plain cards', () => {
	const boardFile = {
		title: 'Reformation Jeopardy',
		published: true,
		cards: [
			{
				front: 'Clue',
				back: 'Answer',
				detail: 'Why.',
				attrs: { board: { category: 'Places', difficulty: 3 } },
			},
			{ front: 'Plain', back: 'Card' },
		],
	};

	it('keeps a typed namespace on the way in', () => {
		const parsed = CreateSetInputSchema.parse(boardFile);
		expect(parsed.cards?.[0].attrs?.board).toEqual({ category: 'Places', difficulty: 3 });
		expect(parsed.cards?.[0].detail).toBe('Why.');
	});

	it('lets a plain card sit in the same set, untagged', () => {
		const parsed = CreateSetInputSchema.parse(boardFile);
		expect(parsed.cards?.[1]).toEqual({ front: 'Plain', back: 'Card' });
	});

	it('re-imports what the API hands back, attrs and all', () => {
		// The export-is-the-import property has to survive game attributes, or a
		// board would silently degrade to a deck on every round trip.
		const exported = SetDetailSchema.parse({
			id: 'qvv7k2mfjxtd',
			title: 'Reformation Jeopardy',
			description: null,
			published: true,
			cardCount: 1,
			isOwner: true,
			createdAt: '2026-08-20T00:00:00.000Z',
			updatedAt: '2026-08-20T00:00:00.000Z',
			cards: [
				{
					id: 'c1',
					front: 'Clue',
					back: 'Answer',
					detail: 'Why.',
					attrs: { board: { category: 'Places', difficulty: 3 } },
				},
			],
		});
		const reimported = ReplaceSetInputSchema.parse(exported);
		expect(reimported.cards[0]).toEqual({
			front: 'Clue',
			back: 'Answer',
			detail: 'Why.',
			attrs: { board: { category: 'Places', difficulty: 3 } },
		});
	});

	it('preserves a namespace this deploy has never heard of', () => {
		// The whole reason attrs is a JSON column: a game can be prototyped in
		// the client before the server knows it exists. Stripping unknown
		// namespaces would make every new mode wait on a deploy.
		const parsed = CreateSetInputSchema.parse({
			title: 'T',
			cards: [{ front: 'a', back: 'b', attrs: { nameThatMap: { region: 'Maguuma', zoom: 3 } } }],
		});
		expect(parsed.cards?.[0].attrs?.nameThatMap).toEqual({ region: 'Maguuma', zoom: 3 });
	});

	it('still validates the namespaces it does know', () => {
		for (const board of [
			{ category: 'Places', difficulty: 0 },
			{ category: 'Places', difficulty: 6 },
			{ category: 'Places', difficulty: 2.5 },
			{ category: '', difficulty: 2 },
			{ category: 'Places' },
		]) {
			const parsed = CreateSetInputSchema.safeParse({
				title: 'T',
				cards: [{ front: 'a', back: 'b', attrs: { board } }],
			});
			expect(parsed.success, JSON.stringify(board)).toBe(false);
		}
	});

	it('caps the bag, because unknown namespaces are unvalidated', () => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			cards: [{ front: 'a', back: 'b', attrs: { blob: { padding: 'x'.repeat(3000) } } }],
		});
		expect(parsed.success).toBe(false);
	});

	it('accepts an explicit null, which is how a card carries no game data', () => {
		const parsed = CreateSetInputSchema.parse({
			title: 'T',
			cards: [{ front: 'a', back: 'b', detail: null, attrs: null }],
		});
		expect(parsed.cards?.[0].attrs).toBeNull();
	});
});

describe('input hygiene survives the round trip', () => {
	it('trims, so a file edited by hand does not store ragged whitespace', () => {
		const parsed = CreateSetInputSchema.parse({
			title: '  Spaced  ',
			cards: [{ front: '  front ', back: ' back  ' }],
		});
		expect(parsed.title).toBe('Spaced');
		expect(parsed.cards?.[0]).toEqual({ front: 'front', back: 'back' });
	});

	it('rejects a card with an empty side rather than storing a blank', () => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			cards: [{ front: 'only', back: '   ' }],
		});
		expect(parsed.success).toBe(false);
	});
});
