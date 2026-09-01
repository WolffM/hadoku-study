/**
 * The export IS the import — and now that both halves live here, that can be
 * asserted directly instead of inferred.
 *
 * `GET /sets/{id}/file` writes a document; `PUT /sets/{id}` reads one. If what
 * the first emits stops parsing as what the second accepts, every round trip
 * breaks at once — a person editing an exported set, an agent handing one
 * back, a scripted backup being restored. Nothing else would notice.
 */

import { describe, expect, it } from 'vitest';
import { readFact, toSetFile, variantId, SET_FILE_VERSION } from './factRows.js';
import { CreateSetInputSchema, ReplaceSetInputSchema } from './schemas.js';
import type { FactRow } from './types.js';

const row = (over: Partial<FactRow> & { id: string }): FactRow => ({
	set_id: 's1',
	position: 0,
	archetype: null,
	slots: JSON.stringify({ prompt: 'кот', answer: 'cat' }),
	questions: null,
	detail: null,
	attrs: null,
	...over,
});

const worms = {
	who: 'Martin Luther and Emperor Charles V',
	what: 'Luther refused to recant his writings',
	where: 'the Diet of Worms',
	when: '1521',
};

const authored = row({
	id: 'worms',
	slots: JSON.stringify(worms),
	questions: JSON.stringify([
		{ ask: 'when', given: ['where'], prompt: 'What year?', seedTier: 2 },
		{ ask: 'who', seedTier: 4 },
	]),
	detail: 'A later embellishment.',
	attrs: JSON.stringify({ board: { category: 'Places' } }),
});

const meta = { title: 'The Reformation', description: 'Luther to Augsburg', published_at: 1 };

describe('reading a stored fact', () => {
	it('parses the JSON columns and expands the questions', () => {
		const fact = readFact(authored);
		expect(fact.slots.when).toBe('1521');
		expect(fact.questions?.map((q) => q.ask)).toEqual(['when', 'who']);
		expect(fact.variants.map((v) => v.ask)).toEqual(['when', 'who']);
	});

	it('degrades a corrupt column rather than failing the whole set', () => {
		// These columns are only written from a validated serialization, so a bad
		// value means corruption upstream — and failing the GET would take a
		// readable set down with it.
		const fact = readFact(row({ id: 'x', slots: 'not json', questions: '{}' }));
		expect(fact.slots).toEqual({});
		expect(fact.variants).toEqual([]);
	});

	it('reads a null questions column as "ask every slot in turn"', () => {
		const fact = readFact(row({ id: 'x', slots: JSON.stringify(worms) }));
		expect(fact.variants).toHaveLength(4);
	});
});

describe('writing the file', () => {
	const file = toSetFile(meta, [readFact(authored), readFact(row({ id: 'plain' }))]);

	it('carries the metadata a reader can ignore', () => {
		expect(file.formatVersion).toBe(SET_FILE_VERSION);
		expect(file.$schema).toContain('openapi.json');
	});

	it('states publication, so a round trip cannot silently unshare a set', () => {
		expect(file.published).toBe(true);
	});

	it('writes every fact’s id', () => {
		// Ratings hang off it and a save replaces facts wholesale, so a file
		// without ids discards everything the set has learned.
		expect(file.facts.map((fact) => fact.id)).toEqual(['worms', 'plain']);
	});

	it('never writes the derived variants', () => {
		// They are recomputed from slots and questions on every read. A copy in
		// the file would be an authoritative-looking second answer, wrong the
		// moment a slot is edited.
		expect(file.facts[0]).not.toHaveProperty('variants');
	});

	it('keeps the authored questions, which are content', () => {
		expect(file.facts[0].questions?.[0]).toEqual({
			ask: 'when',
			given: ['where'],
			prompt: 'What year?',
			seedTier: 2,
		});
	});

	it('omits what a fact has nothing to say about', () => {
		expect(file.facts[1]).not.toHaveProperty('detail');
		expect(file.facts[1]).not.toHaveProperty('attrs');
		expect(file.facts[1]).not.toHaveProperty('questions');
	});

	it('keeps a namespace this deploy has never heard of', () => {
		const exotic = readFact(
			row({ id: 'x', attrs: JSON.stringify({ nameThatMap: { region: 'Maguuma' } }) })
		);
		expect(toSetFile(meta, [exotic]).facts[0].attrs).toEqual({
			nameThatMap: { region: 'Maguuma' },
		});
	});
});

describe('what comes out goes straight back in', () => {
	const file = toSetFile(meta, [readFact(authored), readFact(row({ id: 'plain' }))]);

	it('parses as a PUT body with nothing edited', () => {
		const replaced = ReplaceSetInputSchema.parse(file);
		expect(replaced.title).toBe('The Reformation');
		expect(replaced.facts).toHaveLength(2);
		expect(replaced.facts[0].id).toBe('worms');
		expect(replaced.facts[0].slots).toEqual(worms);
	});

	it('parses as a POST body too, for importing it as a new set', () => {
		expect(CreateSetInputSchema.safeParse(file).success).toBe(true);
	});

	it('drops only the metadata keys, which is what makes them free', () => {
		const replaced = ReplaceSetInputSchema.parse(file);
		expect(Object.keys(replaced).sort()).toEqual(['description', 'facts', 'published', 'title']);
	});
});

describe('variantId', () => {
	it('matches the client’s composite id', () => {
		expect(variantId('f1', 'when<where>')).toBe('f1:when<where>');
	});
});
