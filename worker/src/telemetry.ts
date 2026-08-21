/**
 * What this worker logs, and — just as importantly — what it does not.
 *
 * edge-router already records one row per request: method, path, status,
 * duration, backend, caller tier, masked key, geo. Repeating any of that here
 * would double the volume and add nothing, so this module deliberately logs
 * only the two things the edge CANNOT see from outside the worker:
 *
 *  1. WHY a request failed. The edge sees `POST /study/api/sets 500`; it has
 *     no idea D1 refused the statement. On 2026-08-21 that gap cost a
 *     bisection against production to find a parameter-limit bug that the
 *     underlying error names outright.
 *
 *  2. WHAT the request did. A 201 on `POST /sets` does not say whether it
 *     carried three cards or three hundred, or whether they were board clues.
 *     Those are the facts that answer "is anyone using this, and how" — and
 *     they exist only in here.
 *
 * Everything goes through `@wolffm/logger`'s worker logger rather than a bare
 * `console.log`, so entries carry a service name and structured context and
 * land in the platform's pipeline instead of only in `wrangler tail`.
 */

import { createLogger, formatError } from '@wolffm/worker-utils';

/**
 * Named for THIS worker, not the `worker` default that `logRequest` and
 * `logError` from worker-utils use. Without the name every study entry is
 * indistinguishable from every other worker's in a shared log.
 */
const log = createLogger({ prefix: 'study-worker' });

/** Who did it. The registry userId, which is an internal identifier rather
 *  than a credential — keys rotate, this does not, so it is the stable thing
 *  to correlate a series of actions by. */
export interface Actor {
	userId: string;
}

/**
 * A set changed hands, shape or visibility.
 *
 * One event name per verb rather than a generic "set.write", so a query can
 * count creates without parsing a context field.
 */
export function setEvent(
	verb: 'created' | 'replaced' | 'updated' | 'deleted' | 'cards-replaced',
	actor: Actor,
	setId: string,
	context: Record<string, unknown> = {}
): void {
	log.event(`set.${verb}`, { setId, ownerId: actor.userId, ...context });
}

/**
 * Summarise a deck for a business event.
 *
 * Counts rather than content: a log line is not the place for someone's cards,
 * and the questions worth asking of it are about size and shape. `boardClues`
 * is what makes "how many sets are actually playable as a board" answerable
 * without reading every row in D1.
 */
export function deckShape(cards: { attrs?: Record<string, unknown> | null }[]): {
	cards: number;
	boardClues: number;
	games: string[];
} {
	const games = new Set<string>();
	let boardClues = 0;
	for (const card of cards) {
		for (const key of Object.keys(card.attrs ?? {})) {
			games.add(key);
			if (key === 'board') boardClues += 1;
		}
	}
	return { cards: cards.length, boardClues, games: [...games].sort() };
}

/**
 * An unhandled failure, with the detail the edge cannot see.
 *
 * The shared `createErrorHandlers` already `console.error`s the raw error,
 * which Cloudflare captures — but as an unstructured line outside the logger,
 * so it never reaches the platform pipeline and cannot be queried alongside
 * the request row it belongs to. This adds the structured half; it does not
 * replace the response, which stays deliberately vague to the caller.
 */
export function logUnhandled(method: string, path: string, error: unknown): void {
	log.error(`unhandled error on ${method} ${path}`, {
		method,
		path,
		...formatError(error instanceof Error ? error : String(error)),
	});
}

/** A D1 write that failed, named by the operation that issued it. */
export function logDbFailure(
	operation: string,
	error: unknown,
	context: Record<string, unknown> = {}
): void {
	log.error(`d1 ${operation} failed`, {
		operation,
		...context,
		...formatError(error instanceof Error ? error : String(error)),
	});
}
