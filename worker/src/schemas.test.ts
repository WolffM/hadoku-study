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

const worms = {
	who: 'Martin Luther and Emperor Charles V',
	what: 'Luther refused to recant his writings',
	where: 'the Diet of Worms',
	when: '1521',
};

/** Exactly the shape `GET /sets/{id}` puts in `data.set`. */
const exported = SetDetailSchema.parse({
	id: 'qvv7k2mfjxtd',
	title: 'The Reformation',
	description: 'Luther to Augsburg',
	published: true,
	factCount: 2,
	variantCount: 3,
	isOwner: true,
	createdAt: '2026-08-18T00:00:00.000Z',
	updatedAt: '2026-08-18T00:00:00.000Z',
	facts: [
		{
			id: 'fact-one',
			slots: worms,
			questions: [{ ask: 'when', given: ['where'], prompt: 'In what year?', seedTier: 2 }],
			detail: 'A later embellishment.',
			attrs: null,
			variants: [
				{
					key: 'when<what,where,who>',
					ask: 'when',
					prompt: 'In what year?',
					answer: '1521',
					given: [],
					open: false,
					seedTier: 2,
				},
			],
		},
		{
			id: 'fact-two',
			slots: { prompt: 'кот', answer: 'cat' },
			questions: null,
			detail: null,
			attrs: null,
			variants: [
				{
					key: 'answer<prompt>',
					ask: 'answer',
					prompt: 'кот',
					answer: 'cat',
					given: [],
					open: false,
					seedTier: 3,
				},
			],
		},
	],
});

describe('an exported set re-imports as a new set', () => {
	const reimported = CreateSetInputSchema.parse(exported);

	it('keeps the content', () => {
		expect(reimported.title).toBe('The Reformation');
		expect(reimported.description).toBe('Luther to Augsburg');
		expect(reimported.facts?.[0].slots).toEqual(worms);
		expect(reimported.facts?.[0].detail).toBe('A later embellishment.');
	});

	it('keeps publication, so the round trip loses nothing', () => {
		expect(reimported.published).toBe(true);
	});

	it('accepts the null a fact with no declarations exports as', () => {
		// The output emits `questions: null`; an input that only took undefined
		// would break the round trip for every plain flashcard in existence.
		expect(reimported.facts?.[1].questions).toBeNull();
	});

	it('keeps the authored questions, which are content', () => {
		// Exporting only the resolved variants would bake this build's fallback
		// phrasings in as if someone had written them.
		expect(reimported.facts?.[0].questions).toEqual([
			{ ask: 'when', given: ['where'], prompt: 'In what year?', seedTier: 2 },
		]);
	});

	it('drops the derived variants rather than rejecting them', () => {
		// `variants` is computed from slots and questions on every read. Letting
		// it back in would make a stale copy authoritative over the thing it was
		// derived from.
		expect(Object.keys(reimported).sort()).toEqual(['description', 'facts', 'published', 'title']);
		expect(reimported.facts?.[0]).not.toHaveProperty('variants');
	});
});

describe('a fact carries its id back', () => {
	// This is what stops a save from discarding a set's whole rating history.
	// Ratings hang off `fact_id`, and saving replaces facts wholesale, so an id
	// stripped here is a play history deleted with no error anywhere.
	it('survives into a PUT body', () => {
		const replaced = ReplaceSetInputSchema.parse(exported);
		expect(replaced.facts.map((f) => f.id)).toEqual(['fact-one', 'fact-two']);
	});

	it('survives into a POST body too, where the route ignores it', () => {
		// Keeping it in the schema and ignoring it in the create handler is the
		// deliberate split: one file shape, and the route decides whether an id
		// can mean anything yet.
		const created = CreateSetInputSchema.parse(exported);
		expect(created.facts?.[0].id).toBe('fact-one');
	});
});

describe('an exported set re-imports over an existing set', () => {
	it('requires facts, because a PUT states the whole set', () => {
		const { facts: _facts, ...withoutFacts } = exported;
		expect(ReplaceSetInputSchema.safeParse(withoutFacts).success).toBe(false);
	});

	it('accepts a hand-written file with only a title and facts', () => {
		const minimal = ReplaceSetInputSchema.parse({
			title: 'Hand written',
			facts: [{ slots: { prompt: 'a', answer: 'b' } }],
		});
		// Undefined, NOT false: on PUT that means "leave visibility alone", so a
		// minimal file cannot silently unshare a published set.
		expect(minimal.published).toBeUndefined();
		// Undeclared questions are legal — the server asks every slot in turn.
		expect(minimal.facts[0].questions).toBeUndefined();
	});
});

describe('slot names cannot forge a variant key', () => {
	// A key is `ask<given,given>`. A slot name holding one of those delimiters
	// would produce a key that reads back as a DIFFERENT question, and two
	// questions would silently share one rating row. The delimiters must not
	// appear in the thing being delimited.
	it.each([',', '<', '>', ' ', 'a,b', 'x<y'])('rejects %j', (name) => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { [name]: 'value', other: 'value' } }],
		});
		expect(parsed.success).toBe(false);
	});

	it('accepts the ordinary ones', () => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { when: '1521', 'map-name': 'Queensdale', screenshot_2: 'x' } }],
		});
		expect(parsed.success).toBe(true);
	});
});

describe('a fact needs something to withhold', () => {
	it('rejects a single-slot fact', () => {
		// One slot can only ask a question with no information in it.
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { what: 'something happened' } }],
		});
		expect(parsed.success).toBe(false);
	});

	it('accepts two', () => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { prompt: 'a', answer: 'b' } }],
		});
		expect(parsed.success).toBe(true);
	});
});

describe('declared questions', () => {
	it('round-trip with their phrasing and tier', () => {
		const parsed = CreateSetInputSchema.parse({
			title: 'T',
			facts: [
				{
					slots: worms,
					questions: [
						{ ask: 'when', given: ['where'], prompt: 'What year?', seedTier: 5, open: false },
					],
				},
			],
		});
		expect(parsed.facts?.[0].questions?.[0]).toEqual({
			ask: 'when',
			given: ['where'],
			prompt: 'What year?',
			seedTier: 5,
			open: false,
		});
	});

	it('rejects a seed tier outside the five rungs that exist', () => {
		for (const seedTier of [0, 6, 2.5]) {
			const parsed = CreateSetInputSchema.safeParse({
				title: 'T',
				facts: [{ slots: worms, questions: [{ ask: 'when', seedTier }] }],
			});
			expect(parsed.success, String(seedTier)).toBe(false);
		}
	});
});

describe('game attributes round-trip alongside plain facts', () => {
	it('keeps a typed namespace on the way in', () => {
		const parsed = CreateSetInputSchema.parse({
			title: 'Reformation Jeopardy',
			facts: [{ slots: worms, attrs: { board: { category: 'Places' } } }],
		});
		expect(parsed.facts?.[0].attrs?.board).toEqual({ category: 'Places' });
	});

	it('preserves a namespace this deploy has never heard of', () => {
		// The whole reason attrs is a JSON column: a game can be prototyped in
		// the client before the server knows it exists. Stripping unknown
		// namespaces would make every new mode wait on a deploy.
		const parsed = CreateSetInputSchema.parse({
			title: 'T',
			facts: [
				{ slots: { a: '1', b: '2' }, attrs: { nameThatMap: { region: 'Maguuma', zoom: 3 } } },
			],
		});
		expect(parsed.facts?.[0].attrs?.nameThatMap).toEqual({ region: 'Maguuma', zoom: 3 });
	});

	it('still validates the namespaces it does know', () => {
		for (const board of [{ category: '' }, {}, { category: 'x'.repeat(200) }]) {
			const parsed = CreateSetInputSchema.safeParse({
				title: 'T',
				facts: [{ slots: { a: '1', b: '2' }, attrs: { board } }],
			});
			expect(parsed.success, JSON.stringify(board)).toBe(false);
		}
	});

	it('no longer accepts a difficulty here, because it moved to the variant', () => {
		// 0003 moved it to `seedTier`. Leaving it accepted would let a file put a
		// tier somewhere nothing reads it, which is worse than a rejection.
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { a: '1', b: '2' }, attrs: { board: { category: 'P', difficulty: 3 } } }],
		});
		expect(parsed.success).toBe(false);
	});

	it('caps the bag, because unknown namespaces are unvalidated', () => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { a: '1', b: '2' }, attrs: { blob: { padding: 'x'.repeat(3000) } } }],
		});
		expect(parsed.success).toBe(false);
	});

	it('accepts an explicit null, which is how a fact carries no game data', () => {
		const parsed = CreateSetInputSchema.parse({
			title: 'T',
			facts: [{ slots: { a: '1', b: '2' }, detail: null, attrs: null }],
		});
		expect(parsed.facts?.[0].attrs).toBeNull();
	});
});

describe('input hygiene survives the round trip', () => {
	it('trims, so a file edited by hand does not store ragged whitespace', () => {
		const parsed = CreateSetInputSchema.parse({
			title: '  Spaced  ',
			facts: [{ slots: { prompt: '  front ', answer: ' back  ' } }],
		});
		expect(parsed.title).toBe('Spaced');
		expect(parsed.facts?.[0].slots).toEqual({ prompt: 'front', answer: 'back' });
	});

	it('rejects a slot with an empty value rather than storing a blank', () => {
		const parsed = CreateSetInputSchema.safeParse({
			title: 'T',
			facts: [{ slots: { prompt: 'only', answer: '   ' } }],
		});
		expect(parsed.success).toBe(false);
	});
});
