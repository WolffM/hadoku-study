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
