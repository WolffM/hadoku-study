/**
 * The drift formula is the whole point of v2, so its behaviour is pinned by
 * worked examples rather than by asserting the algebra back to itself.
 *
 * Each case below is a claim about what the system should LEARN from an
 * outcome. If one of them changes, the system has changed its mind about what
 * an answer means — which is a decision, not a refactor.
 */

import { describe, expect, it } from 'vitest';
import {
	BASE_RATING,
	MAX_RATING,
	MIN_RATING,
	confidence,
	drift,
	expectedWin,
	initialState,
	poolMean,
	seedRating,
	streakMultiplier,
	type RatingState,
} from './rating.js';

const state = (over: Partial<RatingState> = {}): RatingState => ({
	rating: BASE_RATING,
	plays: 0,
	run: 0,
	runResult: null,
	...over,
});

describe('seeding', () => {
	it('spreads the five tiers around the field centre', () => {
		expect([1, 2, 3, 4, 5].map(seedRating)).toEqual([1000, 1100, 1200, 1300, 1400]);
	});

	it('puts the middle rung exactly at the base', () => {
		// So a set where nobody declared tiers seeds flat, and drift starts from
		// a genuinely neutral prior rather than from a lopsided one.
		expect(seedRating(3)).toBe(BASE_RATING);
	});
});

describe('what an outcome teaches', () => {
	const cases: [string, RatingState, 'got' | 'missed', number][] = [
		// A fresh question at the field average. The baseline step, and roughly
		// what a plain fixed step would have done.
		['brand new, average, missed', state(), 'missed', 20],
		// Streaks bite: something is genuinely wrong with this one.
		['third miss in a row', state({ plays: 2, run: 2, runResult: 'missed' }), 'missed', 32],
		// Thirty plays of evidence are not overturned by one attempt.
		['well established, missed', state({ plays: 32 }), 'missed', 4],
		// We already knew it was hard. Almost no information in it.
		['rated brutal, missed', state({ rating: 1600, plays: 6 }), 'missed', 2],
		// A genuine surprise, and surprise is what moves a rating.
		['rated brutal, nailed', state({ rating: 1600, plays: 6 }), 'got', -21],
		// You know this. Sink it so the board stops offering it.
		['fourth correct in a row', state({ plays: 8, run: 3, runResult: 'got' }), 'got', -25],
	];

	it.each(cases)('%s', (_label, current, result, expected) => {
		expect(drift(current, BASE_RATING, result).delta).toBe(expected);
	});
});

describe('the streak', () => {
	it('counts the attempt that extends it', () => {
		// Scoring at the PREVIOUS run length would always lag by one, so a
		// two-attempt streak would never get a multiplier at all.
		const first = drift(state(), BASE_RATING, 'missed');
		const second = drift(first.next, BASE_RATING, 'missed');
		expect(second.next.run).toBe(2);
		expect(streakMultiplier(second.next.run)).toBe(1.5);
	});

	it('resets the moment the outcome flips', () => {
		const missed = drift(state({ plays: 5, run: 4, runResult: 'missed' }), BASE_RATING, 'missed');
		expect(missed.next.run).toBe(5);
		const flipped = drift(missed.next, BASE_RATING, 'got');
		expect(flipped.next.run).toBe(1);
		expect(flipped.next.runResult).toBe('got');
	});

	it('stops growing at the cap', () => {
		// A tenth miss is not five times the evidence of a third, and an
		// uncapped multiplier would slam one question into the ceiling and
		// destroy its order against its neighbours.
		expect(streakMultiplier(5)).toBe(3);
		expect(streakMultiplier(50)).toBe(3);
	});

	it('has no effect on the first attempt of a run', () => {
		expect(streakMultiplier(1)).toBe(1);
	});
});

describe('confidence', () => {
	it('starts high and falls with evidence', () => {
		expect(confidence(0)).toBeGreaterThan(confidence(8));
		expect(confidence(8)).toBeGreaterThan(confidence(40));
	});

	it('halves at the half-life', () => {
		expect(confidence(8)).toBeCloseTo(confidence(0) / 2, 6);
	});

	it('never reaches zero, so a settled question can still be re-learnt', () => {
		expect(confidence(10_000)).toBeGreaterThan(0);
	});
});

describe('the field as opponent', () => {
	it('is an even match at the mean', () => {
		expect(expectedWin(BASE_RATING, BASE_RATING)).toBeCloseTo(0.5, 9);
	});

	it('favours a question rated above the field', () => {
		expect(expectedWin(1600, 1200)).toBeCloseTo(10 / 11, 6);
	});

	it('makes an expected outcome move less than a surprising one', () => {
		const hard = state({ rating: 1600, plays: 6 });
		const expectedMiss = Math.abs(drift(hard, 1200, 'missed').delta);
		const surprisingGet = Math.abs(drift(hard, 1200, 'got').delta);
		expect(surprisingGet).toBeGreaterThan(expectedMiss * 5);
	});

	it('is symmetric about the mean', () => {
		// A question 200 above the field, missed, must move exactly as far as
		// one 200 below, got — otherwise the whole set drifts in one direction
		// purely from where the questions happen to sit.
		const above = drift(state({ rating: 1400 }), 1200, 'missed').delta;
		const below = drift(state({ rating: 1000 }), 1200, 'got').delta;
		expect(above).toBe(-below);
	});
});

describe('bounds', () => {
	it('cannot be pushed above the ceiling', () => {
		let current = state({ rating: MAX_RATING - 2 });
		for (let i = 0; i < 40; i += 1) current = drift(current, BASE_RATING, 'missed').next;
		expect(current.rating).toBe(MAX_RATING);
	});

	it('cannot be pushed below the floor', () => {
		let current = state({ rating: MIN_RATING + 2 });
		for (let i = 0; i < 40; i += 1) current = drift(current, BASE_RATING, 'got').next;
		expect(current.rating).toBe(MIN_RATING);
	});

	it('reports the delta that actually happened, not the one it wanted', () => {
		// A caller showing "+18" when the clamp allowed +1 would be lying about
		// the stored value.
		const at = drift(state({ rating: MAX_RATING }), BASE_RATING, 'missed');
		expect(at.delta).toBe(0);
		expect(at.next.rating).toBe(MAX_RATING);
	});
});

describe('the pool mean', () => {
	it('averages every question, played or not', () => {
		expect(poolMean([1000, 1200, 1400])).toBe(1200);
	});

	it('falls back to the base for an empty set', () => {
		// Reachable: the very first attempt in a set nobody has touched.
		expect(poolMean([])).toBe(BASE_RATING);
	});
});

describe('a fresh state', () => {
	it('has no run to extend', () => {
		expect(initialState(1300)).toEqual({ rating: 1300, plays: 0, run: 0, runResult: null });
	});
});

describe('the whole thing converges', () => {
	it('sinks a question the reader always gets right, below one they always miss', () => {
		// The end-to-end claim: play a set honestly and the ordering ends up
		// reflecting what you actually know, whatever it started at.
		let easy = initialState(1400);
		let hard = initialState(1000);
		for (let i = 0; i < 20; i += 1) {
			easy = drift(easy, 1200, 'got').next;
			hard = drift(hard, 1200, 'missed').next;
		}
		expect(easy.rating).toBeLessThan(hard.rating);
	});
});
