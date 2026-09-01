/**
 * Building the shapes the API returns, for tests.
 *
 * Here rather than copied into each test file because a fixture that drifts
 * between three files is a test suite that agrees with itself and not with the
 * server. `variants` in particular is SERVER-DERIVED — nothing in the bundle
 * builds one — so tests have to construct it by hand, and doing that in one
 * place is what keeps them constructing the same thing.
 *
 * Excluded from the declaration build; nothing in the entry imports it, so it
 * never reaches the bundle.
 */

import type { StudyFact, StudySetDetail, StudyVariant } from '../api/types'

export function variant(over: Partial<StudyVariant> = {}): StudyVariant {
  return {
    key: 'answer<prompt>',
    ask: 'answer',
    prompt: 'front',
    answer: 'back',
    given: [],
    open: false,
    seedTier: 3,
    ...over
  }
}

export function fact(over: Partial<StudyFact> & { id: string }): StudyFact {
  return {
    archetype: null,
    slots: { prompt: 'front', answer: 'back' },
    questions: null,
    detail: null,
    attrs: null,
    variants: [variant()],
    ...over
  }
}

/** A migrated v1 card: two slots, asked one way, no game has claimed it. */
export const flashcard = (id: string, front = 'front', back = 'back'): StudyFact =>
  fact({
    id,
    slots: { prompt: front, answer: back },
    questions: [{ ask: 'answer', given: ['prompt'] }],
    variants: [variant({ prompt: front, answer: back })]
  })

/**
 * A fact that can fill a board column, asking `ask`.
 *
 * A column is an ARCHETYPE now, so `over.archetype` is what decides which
 * column this fact lands in; `ask` decides what the question answers. They
 * were the same thing while a column was a slot, which is why so many tests
 * read as though they still are. A fact carries a second slot because it
 * needs something to withhold and something to show.
 */
export const asks = (
  id: string,
  ask: string,
  tier = 3,
  over: { open?: boolean; also?: string[]; archetype?: string | null } = {}
): StudyFact => {
  const extra = over.also ?? []
  const slots: Record<string, string> = { context: `context for ${id}`, [ask]: `${ask} of ${id}` }
  for (const name of extra) slots[name] = `${name} of ${id}`
  const asked = [ask, ...extra]
  return fact({
    id,
    archetype: over.archetype ?? null,
    slots,
    questions: asked.map(name => ({ ask: name, seedTier: tier })),
    variants: asked.map(name =>
      variant({
        key: `${name}<>`,
        ask: name,
        prompt: `What is the ${name} of ${id}?`,
        answer: `${name} of ${id}`,
        seedTier: tier,
        open: over.open ?? false
      })
    )
  })
}

/** A fact with real slots, asked several ways — what authored content looks
 *  like, as opposed to a migrated flashcard. */
export function authored(id: string): StudyFact {
  const slots = { who: 'Luther', what: 'refused to recant', where: 'Worms', when: '1521' }
  return fact({
    id,
    slots,
    questions: [{ ask: 'when' }, { ask: 'where' }],
    variants: [
      variant({
        key: 'when<what,where,who>',
        ask: 'when',
        prompt: 'In what year?',
        answer: '1521',
        given: [
          { slot: 'who', value: 'Luther' },
          { slot: 'what', value: 'refused to recant' },
          { slot: 'where', value: 'Worms' }
        ],
        seedTier: 2
      }),
      variant({
        key: 'where<what,when,who>',
        ask: 'where',
        prompt: 'Where?',
        answer: 'Worms',
        given: [{ slot: 'who', value: 'Luther' }],
        seedTier: 4
      })
    ]
  })
}

export function detailSet(facts: StudyFact[], over: Partial<StudySetDetail> = {}): StudySetDetail {
  return {
    id: 's',
    title: 'T',
    description: null,
    published: false,
    factCount: facts.length,
    variantCount: facts.reduce((total, f) => total + f.variants.length, 0),
    isOwner: true,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    facts,
    ...over
  }
}
