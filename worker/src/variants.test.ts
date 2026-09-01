import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED_TIER, expandFact, variantKey, type QuestionDecl } from './variants.js';

const worms = {
	who: 'Martin Luther and Emperor Charles V',
	what: 'Luther refused to recant his writings',
	where: 'the Diet of Worms',
	when: '1521',
};

describe('variantKey', () => {
	it('is independent of the order givens were listed in', () => {
		// Re-saving a set must not rename a question. A key that depended on
		// array order would orphan the rating every time an editor reordered.
		expect(variantKey('when', ['who', 'what'])).toBe(variantKey('when', ['what', 'who']));
	});

	it('distinguishes the same slot asked with different context', () => {
		// This is the whole difficulty ladder: fewer givens, harder question,
		// separate rating — with nobody having to declare that.
		expect(variantKey('when', ['where'])).not.toBe(variantKey('when', ['who', 'where']));
	});
});

describe('expandFact', () => {
	it('asks every slot in turn when nothing is declared', () => {
		const variants = expandFact(worms, null);
		expect(variants.map((v) => v.ask)).toEqual(['who', 'what', 'where', 'when']);
		// Every generated question gets maximum context, so none are ambiguous.
		expect(variants[3].given.map((g) => g.slot)).toEqual(['who', 'what', 'where']);
	});

	it('renders a migrated flashcard as the card it used to be', () => {
		// The v1 backfill writes exactly this. If it ever stops rendering
		// front-then-back, every existing set silently changes shape.
		const decls: QuestionDecl[] = [{ ask: 'answer', given: ['prompt'], seedTier: 4 }];
		const [only] = expandFact({ prompt: 'кот', answer: 'cat' }, decls);

		expect(only.prompt).toBe('кот');
		expect(only.answer).toBe('cat');
		expect(only.seedTier).toBe(4);
		// The prompt IS the given value — showing it again as context beside
		// itself would render the front twice.
		expect(only.given).toEqual([]);
	});

	it('prefers an authored prompt over the slot template', () => {
		const [v] = expandFact(worms, [{ ask: 'when', prompt: 'What year was the Diet of Worms?' }]);
		expect(v.prompt).toBe('What year was the Diet of Worms?');
	});

	it('falls back to the slot template, with the givens as context', () => {
		const [v] = expandFact(worms, [{ ask: 'when', given: ['where'] }]);
		expect(v.prompt).toBe('In what year?');
		expect(v.given).toEqual([{ slot: 'where', value: 'the Diet of Worms' }]);
	});

	it('marks explain-it slots open and name-it slots not', () => {
		const [why] = expandFact({ ...worms, why: 'It produced the Edict of Worms' }, [{ ask: 'why' }]);
		const [when] = expandFact(worms, [{ ask: 'when' }]);
		expect(why.open).toBe(true);
		expect(when.open).toBe(false);
	});

	it('lets a declaration override the slot default for openness', () => {
		const [v] = expandFact(worms, [{ ask: 'when', open: true }]);
		expect(v.open).toBe(true);
	});

	it('supports slot names it has never heard of', () => {
		const [v] = expandFact({ screenshot: 'queensdale.jpg', map: 'Queensdale', region: 'Kryta' }, [
			{ ask: 'map', given: ['screenshot'], prompt: 'Name that map.' },
		]);
		expect(v.prompt).toBe('Name that map.');
		expect(v.answer).toBe('Queensdale');
	});

	it('skips a declaration whose asked slot no longer exists', () => {
		// Renaming a slot leaves declarations dangling. Rendering fewer
		// questions beats rendering none.
		const variants = expandFact(worms, [{ ask: 'why' }, { ask: 'when' }]);
		expect(variants.map((v) => v.ask)).toEqual(['when']);
	});

	it('drops a given that no longer exists rather than the whole question', () => {
		const [v] = expandFact(worms, [{ ask: 'when', given: ['where', 'why'] }]);
		expect(v.given.map((g) => g.slot)).toEqual(['where']);
		expect(v.key).toBe(variantKey('when', ['where']));
	});

	it('keeps the first of two declarations that resolve to the same question', () => {
		const variants = expandFact(worms, [
			{ ask: 'when', given: ['where'], prompt: 'first' },
			{ ask: 'when', given: ['where'], prompt: 'second' },
		]);
		expect(variants).toHaveLength(1);
		expect(variants[0].prompt).toBe('first');
	});

	it('clamps a seed tier to the five rungs that exist', () => {
		const [low] = expandFact(worms, [{ ask: 'when', seedTier: 0 }]);
		const [high] = expandFact(worms, [{ ask: 'what', seedTier: 99 }]);
		const [absent] = expandFact(worms, [{ ask: 'who' }]);
		expect(low.seedTier).toBe(1);
		expect(high.seedTier).toBe(5);
		expect(absent.seedTier).toBe(DEFAULT_SEED_TIER);
	});
});

/**
 * An archetype narrows what a fact may be ASKED, and nothing else.
 *
 * The filter lives here rather than in the board because the variant key is
 * what ratings hang off: a server that kept generating a question the board
 * refuses to show would accumulate rating rows for questions nobody can reach.
 */
describe('expanding against an archetype', () => {
	const slots = { who: 'Luther', what: 'refused to recant', where: 'Worms', when: '1521' };

	it('asks everything when no archetype constrains the fact', () => {
		// What every set got before archetypes existed, and what a set that
		// declares none still gets.
		const keys = expandFact(slots, null, null).map((v) => v.ask);
		expect(keys.sort()).toEqual(['what', 'when', 'where', 'who']);
	});

	it('asks only the slots the archetype names', () => {
		const asked = expandFact(slots, null, new Set(['who', 'where', 'when'])).map((v) => v.ask);
		expect(asked.sort()).toEqual(['when', 'where', 'who']);
	});

	it('still SHOWS a slot it will not ask', () => {
		// The whole point of demoting rather than deleting: `what` is on nearly
		// every fact, so it makes a poor column and good context.
		const [variant] = expandFact(slots, null, new Set(['who']));
		expect(variant.given.map((g) => g.slot)).toContain('what');
		expect(variant.answer).toBe('Luther');
	});

	it('skips a DECLARED question the archetype does not admit', () => {
		// Narrowing an archetype must not make every fact still naming the old
		// slot refuse to load.
		const declared = [{ ask: 'what' }, { ask: 'when' }];
		const asked = expandFact(slots, declared, new Set(['when'])).map((v) => v.ask);
		expect(asked).toEqual(['when']);
	});

	it('yields nothing when the archetype admits none of the fact’s slots', () => {
		// A fact that cannot answer its own column. The linter reports it on
		// import; here it simply contributes no questions rather than throwing.
		expect(expandFact(slots, null, new Set(['citation']))).toEqual([]);
	});
});
