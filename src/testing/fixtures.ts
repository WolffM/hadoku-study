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

/** The same, sitting on a board at a tier. */
export const clue = (id: string, category: string, tier: number): StudyFact => ({
  ...flashcard(id),
  questions: [{ ask: 'answer', given: ['prompt'], seedTier: tier }],
  attrs: { board: { category } },
  variants: [variant({ seedTier: tier })]
})

/** A fact with real slots, asked several ways — what Phase 3 authoring makes. */
export function authored(id: string, category?: string): StudyFact {
  const slots = { who: 'Luther', what: 'refused to recant', where: 'Worms', when: '1521' }
  return fact({
    id,
    slots,
    questions: [{ ask: 'when' }, { ask: 'where' }],
    attrs: category === undefined ? null : { board: { category } },
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
