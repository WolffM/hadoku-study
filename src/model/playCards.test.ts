/**
 * Flattening facts into the things a game shows.
 *
 * The property that matters: a fact asked four ways is FOUR things to get
 * right. A mode that walked facts would ask about Worms once and call it
 * known, which is exactly the limitation v1's front/back row had and the whole
 * reason it stopped being the unit of storage.
 */

import { describe, expect, it } from 'vitest'
import { countQuestions, playCardId, toPlayCards } from './playCards'
import { authored, clue, fact, flashcard, variant } from '../testing/fixtures'

describe('toPlayCards', () => {
  it('yields one card per question, not per fact', () => {
    const cards = toPlayCards([authored('a')])
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.factId)).toEqual(['a', 'a'])
    expect(cards.map(c => c.variantKey)).toEqual(['when<what,where,who>', 'where<what,when,who>'])
  })

  it('gives each question an id a queue can hold', () => {
    const [first] = toPlayCards([flashcard('a')])
    expect(first.id).toBe(playCardId('a', 'answer<prompt>'))
    // Composite on purpose: two questions over one fact must not collide, and
    // a bare fact id would make them the same entry in a results map.
    expect(first.id).toContain(':')
  })

  it('keeps ids distinct across every question in a set', () => {
    const ids = toPlayCards([authored('a'), authored('b')]).map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders the resolved prompt as the front and the answer as the back', () => {
    const [when] = toPlayCards([authored('a')])
    expect(when.front).toBe('In what year?')
    expect(when.back).toBe('1521')
  })

  it('carries the context a question needs to be answerable', () => {
    // "In what year?" is unanswerable without knowing what happened. The given
    // slots are part of the question, not decoration.
    const [when] = toPlayCards([authored('a')])
    expect(when.given.map(g => g.slot)).toEqual(['who', 'what', 'where'])
  })

  it('leaves a migrated flashcard with no context, because its prompt is the shown side', () => {
    const [only] = toPlayCards([flashcard('a', 'кот', 'cat')])
    expect(only.front).toBe('кот')
    expect(only.given).toEqual([])
  })

  it("copies the fact's detail onto every question over it", () => {
    // The "why" belongs to the fact, so it is shown whichever angle you were
    // asked from.
    const cards = toPlayCards([{ ...authored('a'), detail: 'A later embellishment.' }])
    expect(cards.map(c => c.detail)).toEqual(['A later embellishment.', 'A later embellishment.'])
  })

  it("copies the fact's game bag onto every question over it", () => {
    const cards = toPlayCards([authored('a', 'Places')])
    expect(cards.every(c => c.attrs?.board)).toBe(true)
  })

  it('normalises a missing detail and a missing bag to null', () => {
    const [only] = toPlayCards([flashcard('a')])
    expect(only.detail).toBeNull()
    expect(only.attrs).toBeNull()
  })

  it('carries the seed tier through from the question, not the fact', () => {
    const [only] = toPlayCards([clue('a', 'Places', 5)])
    expect(only.seedTier).toBe(5)
  })

  it('carries openness through, which is how a board finds an explain-it column', () => {
    const open = fact({ id: 'a', variants: [variant({ open: true })] })
    expect(toPlayCards([open])[0].open).toBe(true)
  })

  it('yields nothing for a fact the server expanded into no questions', () => {
    // Every declaration naming a renamed slot is skipped server-side, so this
    // is reachable — and it must render as absent rather than as a blank card.
    expect(toPlayCards([fact({ id: 'a', variants: [] })])).toEqual([])
  })

  it('handles an empty set', () => {
    expect(toPlayCards([])).toEqual([])
  })
})

describe('countQuestions', () => {
  it('adds up what the facts expand into', () => {
    expect(countQuestions([authored('a'), flashcard('b')])).toBe(3)
  })

  it('is zero for an empty set', () => {
    expect(countQuestions([])).toBe(0)
  })
})
