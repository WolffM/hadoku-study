/**
 * Zod schemas for OpenAPI spec generation.
 */

import { z } from '@hono/zod-openapi';
import { DetailedErrorResponseSchema, createSuccessResponseSchema } from '@wolffm/worker-utils';
import {
	MAX_ATTRS_LENGTH,
	MAX_CARDS_PER_SET,
	MAX_CATEGORY_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_DIFFICULTY,
	MAX_FIELD_LENGTH,
	MAX_TITLE_LENGTH,
} from './db.js';

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
 * What the BOARD game hangs on a card.
 *
 * Typed and published in the spec rather than left freeform, so an agent
 * generating a board reads a real schema instead of guessing at an opaque
 * object. Being inside a namespace is what lets the next game define its own
 * `difficulty` without colliding with this one.
 */
export const BoardAttrsSchema = z
	.object({
		/** The board's column. A plain string, not a table: a category has no
		 *  identity beyond its name and no life outside the set using it. */
		category: z.string().trim().min(1).max(MAX_CATEGORY_LENGTH).openapi({ example: 'Places' }),
		/** The board's row. A TIER, not a score, so points can be rescaled at
		 *  render time without rewriting a clue. */
		difficulty: z.number().int().min(1).max(MAX_DIFFICULTY).openapi({ example: 3 }),
	})
	.openapi('BoardAttrs');

/**
 * Per-game attributes, keyed by game id.
 *
 * `.catchall` rather than the default strip: an unknown namespace is a game
 * this deploy has not heard of, and dropping it would make the server the
 * bottleneck on every new mode. Passing it through means a game can be built
 * and played entirely in the client before any of this changes — which is the
 * whole reason this is a JSON column and not three more columns.
 *
 * The cost is that unknown keys are unvalidated, so the SIZE is capped in
 * `assertAttrsSize`; without that this is an unbounded blob store.
 */
export const CardAttrsSchema = z
	.object({ board: BoardAttrsSchema.optional() })
	.catchall(z.unknown())
	.refine((attrs) => JSON.stringify(attrs).length <= MAX_ATTRS_LENGTH, {
		message: `Game attributes must serialize to at most ${MAX_ATTRS_LENGTH} characters.`,
	})
	.openapi('CardAttrs', {
		description:
			'Per-game attributes keyed by game id. Known games are typed; unknown keys are preserved as-is so a new mode needs no schema change. The whole object must serialize to at most ' +
			`${MAX_ATTRS_LENGTH} characters.`,
	});

/** Fields every mode shares, on the entity and the inputs alike. */
const commonCardFields = {
	/** Context revealed after the answer — never the answer itself. Wanted by
	 *  every mode, so it is a real field rather than a namespace entry. */
	detail: z.string().trim().max(MAX_FIELD_LENGTH).nullable().optional(),
	attrs: CardAttrsSchema.nullable().optional(),
};

export const CardSchema = z
	.object({
		id: z.string().openapi({ example: 'qvv7k2mfjxtd' }),
		front: z.string().openapi({ example: 'кот' }),
		back: z.string().openapi({ example: 'cat' }),
		...commonCardFields,
	})
	.openapi('Card');

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
		title: z.string().openapi({ example: 'Russian — animals' }),
		description: z.string().nullable().openapi({ example: 'First 40 nouns' }),
		published: z.boolean().openapi({ example: false }),
		cardCount: z.number().int().openapi({ example: 40 }),
		isOwner: z.boolean().openapi({ example: true }),
		createdAt: z.string().openapi({ example: '2026-08-18T00:00:00.000Z' }),
		updatedAt: z.string().openapi({ example: '2026-08-18T00:00:00.000Z' }),
	})
	.openapi('Set');

export const SetDetailSchema = SetSchema.extend({
	cards: z.array(CardSchema),
}).openapi('SetDetail');

/**
 * A pass's resume bookmark.
 *
 * `results` maps cardId -> a RESULT STRING. Deliberately not a boolean: v2
 * judges typed answers with an LLM and needs a third verdict, and widening a
 * string union is not a migration.
 */
export const ProgressSchema = z
	.object({
		queue: z.array(z.string()).openapi({ example: ['qvv7k2mfjxtd'] }),
		results: z
			.record(z.string(), z.enum(['got', 'missed']))
			.openapi({ example: { qvv7k2mfjxtd: 'got' } }),
		updatedAt: z.string().openapi({ example: '2026-08-18T00:00:00.000Z' }),
	})
	.openapi('Progress');

// ============================================================================
// Inputs
// ============================================================================

const cardInput = z.object({
	front: z.string().trim().min(1).max(MAX_FIELD_LENGTH),
	back: z.string().trim().min(1).max(MAX_FIELD_LENGTH),
	...commonCardFields,
});

/**
 * A whole set as a single importable document — THE file format.
 *
 * This is deliberately a subset of what `GET /sets/{id}` returns, and zod
 * strips unknown keys rather than rejecting them, so the export IS the import:
 * the `set` object from a GET can be POSTed back verbatim, server-owned fields
 * (`id`, `isOwner`, `cardCount`, `createdAt`, `updatedAt`, and each card's
 * `id`) and all. That property is the whole reason a set is portable as one
 * file, so `schemas.round-trip.test.ts` asserts it rather than leaving it to
 * be broken silently by a stray `.strict()`.
 */
export const CreateSetInputSchema = z
	.object({
		title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
		description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
		/** Optional so a paste-import lands as one request rather than two. */
		cards: z.array(cardInput).max(MAX_CARDS_PER_SET).optional(),
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
 * `cards` is REQUIRED here where it is optional on create: a PUT states the
 * set's whole content, and letting it be omitted would make "replace this set"
 * and "leave the deck alone" indistinguishable.
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
		cards: z.array(cardInput).max(MAX_CARDS_PER_SET),
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
 * Cards are replaced WHOLESALE, never patched one at a time.
 *
 * A set is a few kB of text that the editor already holds in full, so a
 * per-card PATCH API would buy nothing but a reorder/insert/delete protocol
 * and the drift that comes with it. The write is one transaction: delete all,
 * insert all.
 */
export const ReplaceCardsInputSchema = z
	.object({
		cards: z.array(cardInput).max(MAX_CARDS_PER_SET),
	})
	.openapi('ReplaceCardsInput');

export const PutProgressInputSchema = z
	.object({
		queue: z.array(z.string()).max(MAX_CARDS_PER_SET),
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

export const CardsResponseSchema = SuccessResponseSchema(
	z.object({ cards: z.array(CardSchema) })
).openapi('CardsResponse');

export const ProgressResponseSchema = SuccessResponseSchema(
	z.object({ progress: ProgressSchema.nullable() })
).openapi('ProgressResponse');

export const DeleteResponseSchema = SuccessResponseSchema(z.object({ setId: z.string() })).openapi(
	'DeleteResponse'
);

export type CardInput = z.infer<typeof cardInput>;
