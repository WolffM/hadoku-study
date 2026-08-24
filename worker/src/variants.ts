/**
 * Turning a fact into the questions you can ask of it.
 *
 * This is the ONLY implementation, and it lives on the server on purpose.
 * A variant's key is what ratings hang off, so two implementations that
 * disagree by a character would silently split one question's history into
 * two — the kind of bug that leaves no error and no trace, only ratings that
 * never converge. `GET /sets/{id}` therefore returns variants fully resolved,
 * keys included, and the client renders what it is given rather than deriving
 * anything.
 *
 * Nothing here is stored. Variants are expanded on read from `slots` and
 * `questions`, which means editing a slot value cannot leave a stale question
 * behind — there is no rendered copy to go stale.
 */

/** A fact's slots: name -> value. Insertion order is the author's order. */
export type Slots = Record<string, string>;

/**
 * One declared question: which slot is the answer, and what you get to see.
 *
 * `given` absent means "every other slot". Dropping givens is how a fact
 * yields a harder question — and because the key includes the given set, the
 * four-given and one-given versions rate independently without anyone having
 * to declare that one is harder. Drift finds the gap on its own.
 */
export interface QuestionDecl {
	ask: string;
	given?: string[];
	prompt?: string;
	open?: boolean;
	seedTier?: number;
}

export interface ResolvedVariant {
	/** Stable across a rephrasing, different when the question differs. */
	key: string;
	ask: string;
	/** The whole front, already resolved — authored, templated, or the sole
	 *  given value in the degenerate flashcard case. */
	prompt: string;
	answer: string;
	/** Context to show alongside the prompt, in the author's slot order. */
	given: { slot: string; value: string }[];
	/** Whether the answer is a thing you explain rather than a thing you name.
	 *  The board generator reads this to guarantee a column you have to talk
	 *  your way through. */
	open: boolean;
	seedTier: number;
}

interface KnownSlot {
	/** Used as the whole prompt when a variant declares none. Deliberately
	 *  terse: the given values are shown beside it, and a template that tried
	 *  to weave them into a sentence would produce exactly the formulaic
	 *  phrasing an authored prompt exists to avoid. */
	question: string;
	open: boolean;
}

/**
 * Slots the system can phrase without help.
 *
 * A published vocabulary, so an agent writing a set has a real target rather
 * than a guess. Unknown slot names are fully supported and always have been —
 * they just need a written `prompt`, since nothing here can invent one.
 */
export const KNOWN_SLOTS: Record<string, KnownSlot> = {
	who: { question: 'Who?', open: false },
	what: { question: 'What happened?', open: false },
	where: { question: 'Where?', open: false },
	when: { question: 'In what year?', open: false },
	// The only two that default to open. An answer you have to explain is a
	// different kind of question from one you name, and self-grading is the
	// only thing that can judge either — but a board still wants to know which
	// is which so it can offer both.
	why: { question: 'Why did it matter?', open: true },
	how: { question: 'How?', open: true },
	quote: { question: 'What were the words?', open: false },
	term: { question: 'What is the term?', open: false },
	definition: { question: 'What does it mean?', open: true },
};

export const MIN_SEED_TIER = 1;
export const MAX_SEED_TIER = 5;
/** The middle rung, for a question that never said. */
export const DEFAULT_SEED_TIER = 3;

/**
 * A variant's identity.
 *
 * The given slots are SORTED here and only here. Sorting makes the key
 * independent of the order an author happened to list them in, so re-saving a
 * set cannot silently rename a question and orphan its rating; the display
 * order is kept separately, in `given`, where it belongs.
 */
export function variantKey(ask: string, given: string[]): string {
	return `${ask}<${[...given].sort().join(',')}>`;
}

/**
 * What to ask when a fact declares nothing: each slot in turn, giving the rest.
 *
 * The safe default — every question it produces has maximum context, so none
 * of them are ambiguous. Harder questions come from declaring fewer givens,
 * which is an authoring decision and not something to guess at.
 */
export function defaultQuestions(slots: Slots): QuestionDecl[] {
	return Object.keys(slots).map((ask) => ({ ask }));
}

function clampTier(tier: number | undefined): number {
	if (tier === undefined || !Number.isFinite(tier)) return DEFAULT_SEED_TIER;
	return Math.min(MAX_SEED_TIER, Math.max(MIN_SEED_TIER, Math.round(tier)));
}

/**
 * Expand a fact into its questions.
 *
 * Tolerant by design, because `slots` and `questions` are two columns that can
 * disagree: renaming a slot leaves any declaration naming it dangling, and a
 * fact that renders no questions is a far worse outcome than one that renders
 * fewer. So a declaration whose `ask` slot is gone is SKIPPED, and a `given`
 * naming a slot that is gone simply loses that entry.
 */
export function expandFact(slots: Slots, questions: QuestionDecl[] | null): ResolvedVariant[] {
	const names = Object.keys(slots);
	const decls = questions && questions.length > 0 ? questions : defaultQuestions(slots);

	const out: ResolvedVariant[] = [];
	const seen = new Set<string>();

	for (const decl of decls) {
		const answer = slots[decl.ask];
		if (answer === undefined) continue;

		// Author order for display, sorted only inside the key.
		const wanted = decl.given ? new Set(decl.given) : null;
		const givenNames = names.filter(
			(name) => name !== decl.ask && (wanted === null || wanted.has(name))
		);

		const key = variantKey(decl.ask, givenNames);
		// First declaration wins a contested key. Two declarations that resolve
		// to the same question is an authoring mistake with no right answer, and
		// letting the last one win would make the result depend on array order
		// in a way nobody can see.
		if (seen.has(key)) continue;
		seen.add(key);

		const known = KNOWN_SLOTS[decl.ask];
		const authored = decl.prompt?.trim();

		let prompt: string;
		let given = givenNames.map((slot) => ({ slot, value: slots[slot] }));

		if (authored) {
			prompt = authored;
		} else if (known) {
			prompt = known.question;
		} else if (given.length === 1) {
			// The degenerate flashcard: one unnamed slot asked, one shown. The
			// shown value IS the question ("кот" -> "cat"), so it becomes the
			// prompt and is not repeated as context beside itself.
			prompt = given[0].value;
			given = [];
		} else {
			prompt = `What is the ${decl.ask}?`;
		}

		out.push({
			key,
			ask: decl.ask,
			prompt,
			answer,
			given,
			open: decl.open ?? known?.open ?? false,
			seedTier: clampTier(decl.seedTier),
		});
	}

	return out;
}
