/**
 * Reading a stored fact into the shape everything else works with.
 *
 * `slots`, `questions` and `attrs` are JSON strings in D1 and objects
 * everywhere above this line — this is the only place that crosses between
 * them. Two routes need it now (content and ratings), and a second copy of
 * "how a fact row is read" is exactly the kind of duplication that ends with
 * two endpoints disagreeing about what questions a fact asks.
 *
 * Tolerant throughout. These columns are only ever written from a validated
 * serialization, so a bad value means corruption upstream — and failing a
 * whole GET over one malformed row would take a readable set down with it.
 */

import { expandFact, type QuestionDecl, type ResolvedVariant, type Slots } from './variants.js';
import type { FactRow } from './types.js';

/** A stored JSON object column, or null when it does not parse as one. */
export function parseObject(raw: string | null): Record<string, unknown> | null {
	if (raw === null || raw === '') return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * The declared questions, or null for "not declared".
 *
 * Null reads as "ask every slot in turn", which `expandFact` already handles —
 * so a corrupt value degrades to the default rather than to no questions.
 */
export function parseQuestions(raw: string | null): QuestionDecl[] | null {
	if (raw === null || raw === '') return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as QuestionDecl[]) : null;
	} catch {
		return null;
	}
}

/** Slot values are strings by schema; anything else is corruption and is
 *  dropped rather than rendered as "[object Object]" on someone's board. */
export function parseSlots(raw: string | null): Slots {
	const parsed = parseObject(raw);
	if (!parsed) return {};
	const out: Slots = {};
	for (const [name, value] of Object.entries(parsed)) {
		if (typeof value === 'string') out[name] = value;
	}
	return out;
}

export interface ReadFact {
	id: string;
	slots: Slots;
	/** As authored. Not the same thing as `variants`, and only this half is
	 *  content — see the note on FactSchema. */
	questions: QuestionDecl[] | null;
	detail: string | null;
	attrs: Record<string, unknown> | null;
	/** Derived here and nowhere else. */
	variants: ResolvedVariant[];
}

export function readFact(row: FactRow): ReadFact {
	const slots = parseSlots(row.slots);
	const questions = parseQuestions(row.questions);
	return {
		id: row.id,
		slots,
		questions,
		detail: row.detail,
		attrs: parseObject(row.attrs),
		variants: expandFact(slots, questions),
	};
}

/** A question's id wherever one is needed as a single string. Mirrors the
 *  client's `playCardId`, and both are `factId:variantKey`. */
export const variantId = (factId: string, variantKey: string): string => `${factId}:${variantKey}`;
