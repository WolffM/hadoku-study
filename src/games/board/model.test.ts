/**
 * Board-ness is derived on every render, so the derivation is the thing worth
 * pinning: it decides whether a set offers a game at all, and it has to give a
 * sane answer for the half-tagged sets that are the normal in-between state.
 */

import { describe, expect, it } from 'vitest'
import { buildBoard, isPlayable, missingForBoard, pointsFor, readBoardAttrs } from './model'
import { toPlayCards } from '../../model/playCards'
import { authored, clue, detailSet, fact, flashcard } from '../../testing/fixtures'

/** The questions a set holds, which is what the board actually places. */
const cardsOf = (facts: Parameters<typeof detailSet>[0]) => toPlayCards(facts)

const clueCards = (...specs: [string, string, number][]) =>
  cardsOf(specs.map(([id, category, tier]) => clue(id, category, tier)))

describe('points', () => {
  it('map a tier to a board value', () => {
    expect([1, 2, 3, 4, 5].map(pointsFor)).toEqual([100, 200, 300, 400, 500])
  })
})

describe("reading this game's namespace off a question", () => {
  it('accepts a fact carrying a category', () => {
    expect(readBoardAttrs(clueCards(['a', 'Places', 1])[0])).toEqual({ category: 'Places' })
  })

  it('ignores a plain flashcard', () => {
    expect(readBoardAttrs(cardsOf([flashcard('a')])[0])).toBeNull()
  })

  it('ignores a fact whose attrs hold only other games', () => {
    const cards = cardsOf([fact({ id: 'a', attrs: { nameThatMap: { region: 'x' } } })])
    expect(readBoardAttrs(cards[0])).toBeNull()
  })

  it('ignores a blank category rather than making a nameless column', () => {
    const cards = cardsOf([fact({ id: 'a', attrs: { board: { category: '  ' } } })])
    expect(readBoardAttrs(cards[0])).toBeNull()
  })

  it('no longer reads a tier from here — that moved to the question', () => {
    // 0003 moved `difficulty` out to `seedTier`, because a tier seeds a rating
    // and ratings belong to every mode, not to this one.
    const cards = cardsOf([fact({ id: 'a', attrs: { board: { category: 'P' } } })])
    expect(readBoardAttrs(cards[0])).toEqual({ category: 'P' })
  })
})

describe('building the grid', () => {
  it('places each question at its category and its seed tier', () => {
    const board = buildBoard(clueCards(['a', 'Places', 1], ['b', 'People', 3]))
    expect(board.categories).toEqual(['Places', 'People'])
    expect(board.cells.get('Places')?.get(1)?.card.factId).toBe('a')
    expect(board.cells.get('People')?.get(3)?.card.factId).toBe('b')
    expect(board.clueCount).toBe(2)
    expect(board.maxScore).toBe(400)
  })

  it('orders columns by first appearance, which is the author’s order', () => {
    const board = buildBoard(clueCards(['a', 'Zebra', 1], ['b', 'Apple', 2]))
    expect(board.categories).toEqual(['Zebra', 'Apple'])
  })

  it('leaves an untagged question off the grid but still in the deck', () => {
    const board = buildBoard(cardsOf([clue('a', 'Places', 1), flashcard('b')]))
    expect(board.clueCount).toBe(1)
    expect(board.unplaced.map(c => c.factId)).toEqual(['b'])
  })

  it('keeps the first of two questions contesting one cell', () => {
    // Common in v2: a fact asked four ways puts four questions in one category
    // at one tier, and exactly one belongs on the grid. Letting the last win
    // would make the board depend on question order in a way nobody can see.
    const board = buildBoard(clueCards(['a', 'Places', 1], ['b', 'Places', 1]))
    expect(board.cells.get('Places')?.get(1)?.card.factId).toBe('a')
    expect(board.unplaced.map(c => c.factId)).toEqual(['b'])
    expect(board.clueCount).toBe(1)
  })

  it('refuses a tier outside the five rungs the grid has', () => {
    const cards = cardsOf([
      {
        ...clue('a', 'Places', 1),
        variants: [{ ...clue('a', 'Places', 1).variants[0], seedTier: 9 }]
      }
    ])
    expect(buildBoard(cards).clueCount).toBe(0)
  })

  it('places every question a multi-slot fact produces', () => {
    // Each is a separate thing to get right, so each competes for its own cell.
    const board = buildBoard(cardsOf([authored('a', 'Places')]))
    expect(board.clueCount).toBe(2)
    expect(board.cells.get('Places')?.get(2)).toBeDefined()
    expect(board.cells.get('Places')?.get(4)).toBeDefined()
  })
})

describe('whether to offer the game at all', () => {
  it('says yes once one question qualifies', () => {
    expect(isPlayable(cardsOf([flashcard('a'), clue('b', 'Places', 1)]))).toBe(true)
  })

  it('says no for a plain deck', () => {
    expect(isPlayable(cardsOf([flashcard('a')]))).toBe(false)
  })
})

describe('telling the author what is missing', () => {
  it('says nothing when the whole set is tagged', () => {
    expect(missingForBoard(clueCards(['a', 'Places', 1]))).toBeNull()
  })

  it('asks for content before anything else', () => {
    expect(missingForBoard([])).toContain('facts')
  })

  it('asks for a category when nothing is tagged', () => {
    expect(missingForBoard(cardsOf([flashcard('a')]))).toContain('category')
  })

  it('counts progress on a half-tagged set', () => {
    const message = missingForBoard(cardsOf([clue('a', 'Places', 1), flashcard('b')]))
    expect(message).toContain('1 of 2')
  })
})
