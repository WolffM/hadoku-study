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

import {
	expandFact,
	type Archetype,
	type QuestionDecl,
	type ResolvedVariant,
	type Slots,
} from './variants.js';
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
	/** Which archetype this fact belongs to, or null for the implicit one. */
	archetype: string | null;
	/** Derived here and nowhere else. */
	variants: ResolvedVariant[];
}

/**
 * Read one stored fact, expanding it against the archetype it belongs to.
 *
 * `askable` is the fact's archetype's `ask` list. Passing null asks every slot,
 * which is what a set that declares no archetypes gets — and what every set got
 * before archetypes existed.
 */
export function readFact(row: FactRow, askable: ReadonlySet<string> | null = null): ReadFact {
	const slots = parseSlots(row.slots);
	const questions = parseQuestions(row.questions);
	return {
		id: row.id,
		slots,
		questions,
		detail: row.detail,
		attrs: parseObject(row.attrs),
		archetype: row.archetype,
		variants: expandFact(slots, questions, askable),
	};
}

/**
 * The `ask` list for each declared archetype, by name.
 *
 * Built once per read of a set rather than per fact: every fact needs the same
 * lookup, and the alternative is re-parsing the set's archetype JSON 22 times.
 */
export function askableByArchetype(
	archetypes: Archetype[] | null
): Map<string, ReadonlySet<string>> {
	const out = new Map<string, ReadonlySet<string>>();
	for (const archetype of archetypes ?? []) out.set(archetype.name, new Set(archetype.ask));
	return out;
}

/** What a fact may be asked, given the set's archetypes. Null = anything. */
export function askableFor(
	row: { archetype: string | null },
	byName: Map<string, ReadonlySet<string>>
): ReadonlySet<string> | null {
	if (row.archetype === null) return null;
	// A fact naming an archetype the set does not declare is not an error here
	// — the linter reports it on import. Falling back to "ask everything" keeps
	// the fact playable rather than making it silently disappear.
	return byName.get(row.archetype) ?? null;
}

/**
 * The version marker a file carries.
 *
 * 3 is archetypes. 2 was facts without them and still imports — every fact
 * joins one implicit archetype and the set plays as a one-column board. 1 was
 * cards, and files in that shape still import too, via the client's converter,
 * because plenty of them exist on people's disks and refusing them would
 * strand sets that convert perfectly.
 */
export const SET_FILE_VERSION = 3 as const;

const SCHEMA_POINTER =
	'https://hadoku.me/study/api/openapi.json#/components/schemas/CreateSetInput';

/**
 * One fact, written only where it has something to say.
 *
 * `id` is written FIRST and always. Ratings and attempt history hang off it and
 * a save replaces a set's facts wholesale, so a file that drops the ids
 * silently discards everything the set has learned. It is the one server-owned
 * field the API reads back rather than strips.
 *
 * `variants` is deliberately absent. It is derived from `slots` and `questions`
 * on every read, and a copy in the file would be an authoritative-looking
 * second answer — wrong the moment a slot is edited.
 */
function factToFile(fact: ReadFact): SetFileFact {
	const out: SetFileFact = { id: fact.id, slots: fact.slots };
	// Second, and before the content: which column a fact belongs to is the
	// first thing a reader of the file needs in order to make sense of its
	// questions.
	if (fact.archetype) out.archetype = fact.archetype;
	if (fact.questions && fact.questions.length > 0) out.questions = fact.questions;
	if (fact.detail) out.detail = fact.detail;
	// Whole and unopened: nothing here knows which games exist, and copying the
	// bag verbatim is what lets a set authored by a newer client survive a round
	// trip through an older one.
	if (fact.attrs && Object.keys(fact.attrs).length > 0) out.attrs = fact.attrs;
	return out;
}

/**
 * A whole set as one portable document.
 *
 * The ONLY implementation. The editor's Export button and `curl .../file` hit
 * this same route rather than each building their own idea of a file — two
 * implementations would eventually disagree about what an export contains, and
 * the symptom would be a UI export that behaves differently from a scripted
 * one for reasons nobody could see.
 */
export interface SetFileFact {
	id: string;
	/** Omitted by a fact in the implicit archetype — there is nothing to name. */
	archetype?: string;
	slots: Slots;
	questions?: QuestionDecl[];
	detail?: string;
	attrs?: Record<string, unknown>;
}

export interface SetFile {
	$schema: string;
	formatVersion: typeof SET_FILE_VERSION;
	title: string;
	description: string | null;
	published: boolean;
	/** Omitted entirely by a set that declares none, so a simple set exports
	 *  as simply as it did before archetypes existed. */
	archetypes?: Archetype[];
	facts: SetFileFact[];
}

export function toSetFile(
	set: {
		title: string;
		description: string | null;
		published_at: number | null;
		archetypes?: Archetype[] | null;
	},
	facts: ReadFact[]
): SetFile {
	const archetypes = set.archetypes ?? null;
	return {
		$schema: SCHEMA_POINTER,
		formatVersion: SET_FILE_VERSION,
		title: set.title,
		description: set.description,
		published: set.published_at !== null,
		...(archetypes && archetypes.length > 0 ? { archetypes } : {}),
		facts: facts.map(factToFile),
	};
}

/** A question's id wherever one is needed as a single string. Mirrors the
 *  client's `playCardId`, and both are `factId:variantKey`. */
export const variantId = (factId: string, variantKey: string): string => `${factId}:${variantKey}`;
