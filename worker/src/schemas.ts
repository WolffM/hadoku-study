/**
 * Zod schemas for OpenAPI spec generation.
 */

import { z } from '@hono/zod-openapi';
import { DetailedErrorResponseSchema, createSuccessResponseSchema } from '@wolffm/worker-utils';
import {
	MAX_ATTRS_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_FACTS_PER_SET,
	MAX_FIELD_LENGTH,
	MAX_QUESTIONS_PER_FACT,
	MAX_SLOTS_PER_FACT,
	MAX_SLOT_NAME_LENGTH,
	MAX_TITLE_LENGTH,
	MAX_ATTEMPTS_PER_REQUEST,
} from './db.js';
import { MAX_SEED_TIER, MIN_SEED_TIER } from './variants.js';

export const ErrorResponseSchema = DetailedErrorResponseSchema;

export const HealthResponseSchema = z
	.object({
		status: z.enum(['healthy', 'degraded', 'unhealthy']),
		service: z.literal('study-worker'),
		timestamp: z.string(),
		database: z.boolean().optional(),
		version: z.string().optional(),
	})
	.openapi('HealthResponse');

export const SuccessResponseSchema = createSuccessResponseSchema;

// ============================================================================
// Entities
// ============================================================================

/**
 * Per-game attributes, keyed by game id.
 *
 * `.catchall` rather than the default strip: a namespace here is a game this
 * deploy has not heard of, and dropping it would make the server the
 * bottleneck on every new mode. Passing it through means a game can be built
 * and played entirely in the client before any of this changes.
 *
 * There are currently NO typed namespaces. `board` used to hold a per-fact
 * category; the board now derives its columns from the slots a set's questions
 * ask, so nothing reads a namespace at all and typing one would be describing
 * a field with no reader. The mechanism stays because the next game will want
 * it — and because a set authored by a newer client still has to round-trip
 * through this one untouched.
 *
 * The cost is that these keys are unvalidated, so the SIZE is capped below;
 * without that this is an unbounded blob store.
 */
export const FactAttrsSchema = z
	.object({})
	.catchall(z.unknown())
	.refine((attrs) => JSON.stringify(attrs).length <= MAX_ATTRS_LENGTH, {
		message: `Game attributes must serialize to at most ${MAX_ATTRS_LENGTH} characters.`,
	})
	.openapi('FactAttrs', {
		description:
			'Per-game attributes keyed by game id, preserved as-is so a new mode needs no schema change. No namespace is currently read by any game. The whole object must serialize to at most ' +
			`${MAX_ATTRS_LENGTH} characters.`,
	});

/**
 * A slot name.
 *
 * Restricted to letters, digits, underscore and hyphen — NOT cosmetic. A
 * variant key is `ask<given,given>`, so a slot name containing a comma or an
 * angle bracket would produce a key that parses back as a different question,
 * and ratings would silently merge two questions into one row. The delimiters
 * cannot appear in the thing being delimited.
 */
const slotName = z
	.string()
	.trim()
	.min(1)
	.max(MAX_SLOT_NAME_LENGTH)
	.regex(/^[A-Za-z0-9_-]+$/, {
		message: 'Slot names may use letters, digits, underscores and hyphens only.',
	});

/**
 * What is true, as named values.
 *
 * At least TWO, because a question needs something to withhold and something
 * to show: a one-slot fact can only ask a question with no information in it.
 * `who` / `what` / `where` / `when` / `why` are phrased automatically; any
 * other name works and just wants a written `prompt`.
 */
export const SlotsSchema = z
	.record(slotName, z.string().trim().min(1).max(MAX_FIELD_LENGTH))
	.refine((slots) => Object.keys(slots).length >= 2, {
		message: 'A fact needs at least two slots — one to ask, one to show.',
	})
	.refine((slots) => Object.keys(slots).length <= MAX_SLOTS_PER_FACT, {
		message: `A fact may have at most ${MAX_SLOTS_PER_FACT} slots.`,
	})
	.openapi('Slots', {
		description:
			'Named values that make up the fact. Insertion order is the order context is shown in.',
		example: {
			who: 'Martin Luther and Emperor Charles V',
			what: 'Luther refused to recant his writings',
			where: 'the Diet of Worms',
			when: '1521',
		},
	});

/**
 * One declared question over a fact.
 *
 * `given` omitted means every other slot — the safe default, since a question
 * with maximum context is never ambiguous. Naming FEWER givens is how a fact
 * yields a harder question, and because the given set is part of the variant
 * key, the two rate independently without anyone declaring which is harder.
 */
export const QuestionSchema = z
	.object({
		ask: slotName.openapi({ example: 'when', description: 'Which slot is the answer.' }),
		given: z
			.array(slotName)
			.max(MAX_SLOTS_PER_FACT)
			.optional()
			.openapi({ description: 'Slots to show. Omit for all of the others.' }),
		prompt: z.string().trim().max(MAX_FIELD_LENGTH).optional().openapi({
			example: 'What year did Luther refuse to recant before Charles V?',
			description:
				'How the question reads. Strongly preferred over the fallback: a written prompt is what keeps a set from sounding like a form.',
		}),
		open: z.boolean().optional().openapi({
			description:
				'Whether the answer is explained rather than named. Defaults from the asked slot.',
		}),
		seedTier: z
			.number()
			.int()
			.min(MIN_SEED_TIER)
			.max(MAX_SEED_TIER)
			.optional()
			.openapi({ example: 2, description: 'Starting difficulty, 1–5. Seeds the rating only.' }),
	})
	.openapi('Question');

/**
 * A question as the API RETURNS it — resolved, keyed, ready to render.
 *
 * Derived on read and never stored. The `key` is what ratings hang off, and it
 * is computed in exactly one place on the server so that two implementations
 * can never disagree about which question a rating belongs to.
 */
export const VariantSchema = z
	.object({
		key: z.string().openapi({ example: 'when<what,where,who>' }),
		ask: z.string().openapi({ example: 'when' }),
		/** The whole front. Authored, templated, or — for a migrated flashcard —
		 *  the single shown value. */
		prompt: z.string().openapi({ example: 'What year did Luther refuse to recant?' }),
		answer: z.string().openapi({ example: '1521' }),
		given: z
			.array(z.object({ slot: z.string(), value: z.string() }))
			.openapi({ description: 'Context to show beside the prompt, in the author’s slot order.' }),
		open: z.boolean().openapi({ example: false }),
		seedTier: z.number().int().openapi({ example: 2 }),
	})
	.openapi('Variant');

export const FactSchema = z
	.object({
		id: z.string().openapi({ example: 'qvv7k2mfjxtd' }),
		slots: SlotsSchema,
		/**
		 * The declarations as AUTHORED, null when the fact declares none.
		 *
		 * Returned alongside the resolved variants because they are not the same
		 * thing and only one of them is content. Exporting from `variants` alone
		 * would bake this build's fallback phrasings in as authored prompts, so
		 * every round trip would quietly freeze a template into the set.
		 */
		questions: z.array(QuestionSchema).nullable(),
		/** Context revealed after the answer — never the answer itself. */
		detail: z.string().nullable().openapi({ example: '“Here I stand” is a later embellishment.' }),
		attrs: FactAttrsSchema.nullable(),
		/** Server-derived, and stripped on the way back in — which is what keeps
		 *  a GET response a valid import body. */
		variants: z.array(VariantSchema),
	})
	.openapi('Fact');

/**
 * A set as the API returns it.
 *
 * `isOwner` is the client's cue for whether to offer edit/publish controls. It
 * is a CONVENIENCE, never the seal — the worker re-derives ownership from the
 * edge-injected userId on every write, so a client that flips this flag gains
 * nothing.
 */
export const SetSchema = z
	.object({
		id: z.string().openapi({ example: 'qvv7k2mfjxtd' }),
		title: z.string().openapi({ example: 'The Reformation' }),
		description: z.string().nullable().openapi({ example: 'Luther to the Peace of Augsburg' }),
		published: z.boolean().openapi({ example: false }),
		/** Things that are true. */
		factCount: z.number().int().openapi({ example: 25 }),
		/**
		 * Questions those facts can be asked as — always at least the fact
		 * count, and the number that actually matters when picking a mode.
		 *
		 * Absent from the LIST endpoints, present on every detail response.
		 * Counting it means expanding every fact, and the only way to avoid
		 * that in a list query would be to re-derive the expansion rule in SQL
		 * — a second implementation of the one thing that must not have two.
		 */
		variantCount: z.number().int().optional().openapi({ example: 91 }),
		isOwner: z.boolean().openapi({ example: true }),
		createdAt: z.string().openapi({ example: '2026-08-18T00:00:00.000Z' }),
		updatedAt: z.string().openapi({ example: '2026-08-18T00:00:00.000Z' }),
	})
	.openapi('Set');

export const SetDetailSchema = SetSchema.extend({
	/** Always present here, unlike on a list entry. */
	variantCount: z.number().int().openapi({ example: 91 }),
	facts: z.array(FactSchema),
}).openapi('SetDetail');

/**
 * A pass's resume bookmark.
 *
 * `queue` and the keys of `results` are VARIANT ids — `factId:variantKey` —
 * not fact ids. A pass walks questions, and two questions over the same fact
 * are two separate things to get right.
 */
export const ProgressSchema = z
	.object({
		queue: z.array(z.string()).openapi({ example: ['qvv7k2mfjxtd:when<what,where,who>'] }),
		results: z
			.record(z.string(), z.enum(['got', 'missed']))
			.openapi({ example: { 'qvv7k2mfjxtd:when<what,where,who>': 'got' } }),
		updatedAt: z.string().openapi({ example: '2026-08-18T00:00:00.000Z' }),
	})
	.openapi('Progress');

// ============================================================================
// Inputs
// ============================================================================

const factInput = z.object({
	/**
	 * The fact's existing id, handed back so a save keeps its rating history.
	 *
	 * Server-owned, and OPTIONAL because most callers have no business
	 * inventing one — a create always mints. On `PUT /sets/{id}` an id is
	 * honoured only when it already belongs to that set, so re-importing your
	 * own export preserves everything a set has learned, while a hand-edited
	 * file cannot adopt another set's history.
	 */
	id: z.string().max(64).optional(),
	slots: SlotsSchema,
	questions: z.array(QuestionSchema).max(MAX_QUESTIONS_PER_FACT).nullable().optional().openapi({
		description:
			'Omit to ask every slot in turn, giving all the others. Explicitly null means the same thing — a fact that declares none exports as null, and the export has to parse straight back in.',
	}),
	detail: z.string().trim().max(MAX_FIELD_LENGTH).nullable().optional(),
	attrs: FactAttrsSchema.nullable().optional(),
});

/**
 * A whole set as a single importable document — THE file format.
 *
 * This is deliberately a subset of what `GET /sets/{id}` returns, and zod
 * strips unknown keys rather than rejecting them, so the export IS the import:
 * the `set` object from a GET can be POSTed back verbatim, server-owned fields
 * (`id`, `isOwner`, `factCount`, `variantCount`, `createdAt`, `updatedAt`, and
 * each fact's `variants`) and all. That property is the whole reason a set is
 * portable as one file, so `schemas.test.ts` asserts it rather than leaving it
 * to be broken silently by a stray `.strict()`.
 *
 * A fact's `id` is the one server-owned field that is READ rather than
 * stripped — see `factInput.id`. It is ignored here, where there is no set for
 * it to name, and honoured by PUT, where it is what keeps a save from
 * discarding the set's rating history.
 */
export const CreateSetInputSchema = z
	.object({
		title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
		description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
		/** Optional so a paste-import lands as one request rather than two. */
		facts: z.array(factInput).max(MAX_FACTS_PER_SET).optional(),
		/**
		 * Publish on create, so importing an already-public set is one request
		 * rather than a POST followed by a PATCH. Omitted means private, which
		 * is the same default a set created in the UI gets.
		 */
		published: z.boolean().optional(),
	})
	.openapi('CreateSetInput');

/**
 * The body of `PUT /sets/{id}` — the same file, written over an existing set.
 *
 * `facts` is REQUIRED here where it is optional on create: a PUT states the
 * set's whole content, and letting it be omitted would make "replace this set"
 * and "leave the content alone" indistinguishable.
 *
 * `published` omitted means LEAVE VISIBILITY ALONE, not "make private". A file
 * describes a set's CONTENT; publication is access control on the row, not
 * content, so a hand-written file that never mentions it must not silently
 * unshare someone's set. An exported file always carries the flag, so a true
 * round trip is still lossless.
 */
export const ReplaceSetInputSchema = z
	.object({
		title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
		description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
		facts: z.array(factInput).max(MAX_FACTS_PER_SET),
		published: z.boolean().optional(),
	})
	.openapi('ReplaceSetInput');

export const UpdateSetInputSchema = z
	.object({
		title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
		description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
		published: z.boolean().optional(),
	})
	.openapi('UpdateSetInput');

/**
 * How one question stands, both ways at once.
 *
 * Global and local side by side because they answer different questions and a
 * reader wants both: global is what the field thinks, local is what YOUR play
 * has made of it. They start equal and diverge.
 */
export const RatingSchema = z
	.object({
		factId: z.string().openapi({ example: 'qvv7k2mfjxtd' }),
		variantKey: z.string().openapi({ example: 'when<what,where,who>' }),
		/** Everyone's, seeded from `seedTier` until somebody plays it. */
		global: z.number().int().openapi({ example: 1186 }),
		/**
		 * Yours. Equal to `global` until you have attempted this question, then
		 * it is yours alone — nothing overwrites it again.
		 */
		local: z.number().int().openapi({ example: 1174 }),
		globalPlays: z.number().int().openapi({ example: 12 }),
		yourPlays: z.number().int().openapi({ example: 3 }),
	})
	.openapi('Rating');

/**
 * The same, plus what this request did to it.
 *
 * Only `POST /attempts` answers with these — a plain read has no movement to
 * report, and an always-present `delta` that is always zero on a GET would be
 * a field a caller has to know not to trust. The clamp is already applied, so
 * a recap showing `+18` where the ceiling allowed `+1` is impossible.
 */
export const RatingChangeSchema = RatingSchema.extend({
	globalDelta: z.number().int().openapi({ example: -14 }),
	localDelta: z.number().int().openapi({ example: -26 }),
}).openapi('RatingChange');

/**
 * One answer, as reported by whoever was playing.
 *
 * Self-graded, and that is the whole grading story — open-ended and discrete
 * questions travel the identical path. `response` is what was typed, when
 * anything was: it costs nothing now and is the only thing that would make a
 * retroactive judge possible later.
 */
export const AttemptInputSchema = z
	.object({
		factId: z.string(),
		variantKey: z.string(),
		result: z.enum(['got', 'missed']),
		response: z.string().trim().max(MAX_FIELD_LENGTH).nullable().optional(),
	})
	.openapi('AttemptInput');

export const RecordAttemptsInputSchema = z
	.object({
		/** Which mode this was played in. Free-form, because a game can exist
		 *  before the server has heard of it. */
		game: z.string().trim().min(1).max(MAX_SLOT_NAME_LENGTH),
		attempts: z.array(AttemptInputSchema).min(1).max(MAX_ATTEMPTS_PER_REQUEST),
	})
	.openapi('RecordAttemptsInput');

/**
 * Handing a set to someone else, BY NAME.
 *
 * A recipient is named by their registry DISPLAY NAME — the identifier a human
 * actually has, and one that changes no credential hands. The worker resolves
 * it against the key registry and stores the resulting userId, echoing the name
 * and tier back so the caller can confirm they hit the right identity (R4).
 *
 * IT USED TO TAKE A `userId`, AND THAT WAS THE INCIDENT. The reasoning was that
 * a userId is not a credential, so accepting one is safe — true, and beside the
 * point. What made it unsafe is that nothing RESOLVED it: an unresolved
 * identifier in a request body is a claim, and this endpoint stored the claim.
 * On 2026-08-25 `{"userId": "hadoku"}` was accepted (`hadoku` is a DISPLAY
 * NAME; the registry row is `Hadoku` and its userId is `de5c2a05-…`) and a set
 * became owned by nobody for two days.
 *
 * The first fix was a UUID regex, which was then deleted for being a format
 * opinion. Both were the wrong axis. A registry lookup rejects `hadoku` AND a
 * well-formed UUID belonging to nobody, which a regex waves through — so the
 * rule is not "check the shape", it is NEVER STORE AN IDENTIFIER YOU DID NOT
 * RESOLVE.
 *
 * See docs/architecture/IDENTITY_MODEL.md in hadoku_site.
 */
export const TransferOwnerInputSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1)
			.max(MAX_SLOT_NAME_LENGTH * 4)
			.optional()
			.openapi({
				example: 'thyeggman',
				description:
					"The recipient's registry display name, as shown in the sharing picker (GET /session/users/search). Matched case-insensitively against live keys. Omit to claim the set for the CALLER, which is how an admin adopts a set whose owner no longer holds a key.",
			}),
	})
	// STRICT, and that is load-bearing. zod's default is to strip an unknown key
	// silently, which would turn an old client's `{"userId": "…"}` into an empty
	// body — i.e. into a SELF-CLAIM. Quietly assigning the set to the caller
	// instead of the person they named is a worse failure than the one this
	// endpoint already had, because nothing would report it. Strict makes the
	// retired field a 400 that names itself.
	.strict()
	.openapi('TransferOwnerInput');

export const PutProgressInputSchema = z
	.object({
		queue: z.array(z.string()).max(MAX_FACTS_PER_SET * MAX_QUESTIONS_PER_FACT),
		results: z.record(z.string(), z.enum(['got', 'missed'])),
	})
	.openapi('PutProgressInput');

// ============================================================================
// Responses
// ============================================================================

export const SetsResponseSchema = SuccessResponseSchema(
	z.object({ sets: z.array(SetSchema) })
).openapi('SetsResponse');

export const SetDetailResponseSchema = SuccessResponseSchema(
	z.object({ set: SetDetailSchema })
).openapi('SetDetailResponse');

export const SetResponseSchema = SuccessResponseSchema(z.object({ set: SetSchema })).openapi(
	'SetResponse'
);

/**
 * What a hand-over returns: the set, plus WHO it went to.
 *
 * The echo is the point (R4). A transfer is the one change that alters who may
 * edit a set and the only one its previous owner cannot undo alone, so the
 * caller gets the resolved display name and tier back and can see they hit the
 * identity they meant. Absent on the empty-body self-claim, where there is
 * nobody to confirm.
 */
export const TransferOwnerResponseSchema = SuccessResponseSchema(
	z.object({
		set: SetSchema,
		grantedTo: z
			.object({ name: z.string().nullable(), tier: z.string().nullable() })
			.optional()
			.openapi({ description: 'The resolved recipient. Omitted when claiming the set yourself.' }),
	})
).openapi('TransferOwnerResponse');

export const ProgressResponseSchema = SuccessResponseSchema(
	z.object({ progress: ProgressSchema.nullable() })
).openapi('ProgressResponse');

export const DeleteResponseSchema = SuccessResponseSchema(z.object({ setId: z.string() })).openapi(
	'DeleteResponse'
);

/**
 * A set as a portable document — the thing you hand a research agent.
 *
 * Deliberately NOT wrapped in `{success, data}`. This is a file: one URL, one
 * object, paste-ready. The wrapper is right for an API a program is driving
 * and wrong for a document a person is copying.
 *
 * It is exactly a `ReplaceSetInput` plus two ignorable metadata keys, so what
 * comes out of here goes straight back in with nothing edited — and the fact
 * `id`s ride along, which is what keeps a round trip from discarding a set's
 * rating history.
 */
export const SetFileSchema = z
	.object({
		$schema: z.string(),
		formatVersion: z.literal(2),
		title: z.string(),
		description: z.string().nullable(),
		published: z.boolean(),
		facts: z.array(
			z.object({
				id: z.string(),
				slots: SlotsSchema,
				questions: z.array(QuestionSchema).optional(),
				detail: z.string().optional(),
				attrs: FactAttrsSchema.optional(),
			})
		),
	})
	.openapi('SetFile');

export const RatingsResponseSchema = SuccessResponseSchema(
	z.object({ ratings: z.array(RatingSchema) })
).openapi('RatingsResponse');

export const RatingChangesResponseSchema = SuccessResponseSchema(
	z.object({ ratings: z.array(RatingChangeSchema) })
).openapi('RatingChangesResponse');

export type FactInput = z.infer<typeof factInput>;
