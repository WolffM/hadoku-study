/**
 * The edits an author makes to a fact.
 *
 * Two of these are quietly destructive if they get it wrong. Renaming a slot
 * has to carry through the declarations that name it, or the question stops
 * resolving and simply disappears from the set — no error, one fewer question.
 * And removing a slot has to take the questions that asked it, or the set
 * carries declarations that render nothing.
 */

import { describe, expect, it } from 'vitest'
import type { FactInput } from '../api/types'
import {
  blankFact,
  cleaned,
  factIssue,
  isBlank,
  isSimple,
  removeSlot,
  renameSlot,
  simpleTier,
  withTier
} from './factEdits'

const worms = (): FactInput => ({
  slots: { who: 'Luther', what: 'refused to recant', where: 'Worms', when: '1521' },
  questions: [
    { ask: 'when', given: ['where', 'who'] },
    { ask: 'where', prompt: 'Where?' }
  ]
})

describe('telling a flashcard from a fact', () => {
  it('accepts the two-slot pair the v1 backfill made', () => {
    expect(isSimple({ slots: { prompt: 'a', answer: 'b' } })).toBe(true)
    expect(
      isSimple({
        slots: { prompt: 'a', answer: 'b' },
        questions: [{ ask: 'answer', given: ['prompt'] }]
      })
    ).toBe(true)
  })

  it('refuses anything with authoring in it', () => {
    // Each of these has something two text inputs cannot express.
    expect(isSimple(worms())).toBe(false)
    expect(isSimple({ slots: { prompt: 'a', answer: 'b', why: 'c' } })).toBe(false)
    expect(isSimple({ slots: { term: 'a', definition: 'b' } })).toBe(false)
    expect(
      isSimple({
        slots: { prompt: 'a', answer: 'b' },
        questions: [{ ask: 'answer' }, { ask: 'prompt' }]
      })
    ).toBe(false)
    expect(isSimple({ slots: { prompt: 'a', answer: 'b' }, questions: [{ ask: 'prompt' }] })).toBe(
      false
    )
  })

  it('starts a new fact as one', () => {
    expect(isSimple(blankFact())).toBe(true)
    // Declared, never left to the default expansion — which would also generate
    // the reverse question and quietly double the set.
    expect(blankFact().questions).toEqual([{ ask: 'answer', given: ['prompt'] }])
  })
})

describe('renaming a slot', () => {
  it('carries the rename through every declaration that names it', () => {
    // Otherwise the question names a slot that no longer exists, stops
    // resolving, and vanishes from the set with no error anywhere.
    const renamed = renameSlot(worms(), 'where', 'place')
    expect(Object.keys(renamed.slots)).toEqual(['who', 'what', 'place', 'when'])
    expect(renamed.questions?.[0].given).toEqual(['place', 'who'])
    expect(renamed.questions?.[1].ask).toBe('place')
  })

  it('keeps the slot in its place', () => {
    // Slot order is the order context is shown in, so a rename that sent a slot
    // to the bottom would silently reorder the question it appears in.
    expect(Object.keys(renameSlot(worms(), 'who', 'person').slots)).toEqual([
      'person',
      'what',
      'where',
      'when'
    ])
  })

  it('refuses a name that would merge two slots', () => {
    const fact = worms()
    expect(renameSlot(fact, 'who', 'what')).toBe(fact)
  })

  it('refuses a blank name', () => {
    const fact = worms()
    expect(renameSlot(fact, 'who', '   ')).toBe(fact)
  })

  it('is a no-op when nothing changed', () => {
    const fact = worms()
    expect(renameSlot(fact, 'who', 'who')).toBe(fact)
  })
})

describe('removing a slot', () => {
  it('takes the questions that asked it', () => {
    const without = removeSlot(worms(), 'where')
    expect(without.slots.where).toBeUndefined()
    expect(without.questions?.map(q => q.ask)).toEqual(['when'])
  })

  it('drops it from the questions that only showed it', () => {
    const without = removeSlot(worms(), 'who')
    expect(without.questions?.[0].given).toEqual(['where'])
    expect(without.questions).toHaveLength(2)
  })
})

describe('the starting tier', () => {
  it('lives on the question', () => {
    // A tier seeds a RATING, and ratings belong to every mode — which is why it
    // left the board's namespace in 0003, and why the namespace itself is now
    // gone entirely.
    const tiered = withTier(blankFact(), 4)
    expect(simpleTier(tiered)).toBe(4)
    expect(tiered.attrs).toBeUndefined()
  })

  it('clears back to the default', () => {
    expect(simpleTier(withTier(withTier(blankFact(), 4), null))).toBeNull()
  })

  it('keeps the declaration it was set on', () => {
    expect(withTier(blankFact(), 2).questions?.[0].given).toEqual(['prompt'])
  })
})

describe('cleaning up on the way out', () => {
  it('trims and drops slots that are only whitespace', () => {
    const tidy = cleaned({ slots: { prompt: '  front ', answer: '   ' }, detail: '  ' })
    expect(tidy.slots).toEqual({ prompt: 'front' })
    expect(tidy.detail).toBeNull()
  })
})

describe('what is wrong with a fact', () => {
  it('says nothing about a fact with two sides', () => {
    expect(factIssue({ slots: { prompt: 'a', answer: 'b' } })).toBeNull()
    expect(factIssue(worms())).toBeNull()
  })

  it('phrases a half-typed flashcard as a missing side', () => {
    expect(factIssue({ slots: { prompt: 'a', answer: '' } })).toBe('is missing a side')
  })

  it('phrases a half-typed fact as missing slots', () => {
    const issue = factIssue({ slots: { who: 'Luther', what: '', where: '' } })
    expect(issue).toContain('two slots')
  })

  it('knows a row nobody has typed into', () => {
    expect(isBlank(blankFact())).toBe(true)
    expect(isBlank({ slots: { prompt: 'a', answer: '' } })).toBe(false)
    // Detail alone is content: dropping it silently would lose work.
    expect(isBlank({ slots: { prompt: '', answer: '' }, detail: 'note' })).toBe(false)
  })
})
