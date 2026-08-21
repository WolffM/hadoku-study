/**
 * Board-ness is derived on every render, so the derivation is the thing worth
 * pinning: it decides whether a set offers a game at all, and it has to give a
 * sane answer for the half-tagged sets that are the normal in-between state.
 */

import { describe, expect, it } from 'vitest'
import { buildBoard, isPlayable, missingForBoard, pointsFor, readBoardAttrs } from './model'
import type { StudyCard, StudySetDetail } from '../../api/types'

const card = (over: Partial<StudyCard> & { id: string }): StudyCard => ({
  front: 'front',
  back: 'back',
  ...over
})

const clue = (id: string, category: string, difficulty: number) =>
  card({ id, attrs: { board: { category, difficulty } } })

describe('points', () => {
  it('map a tier to a board value', () => {
    expect([1, 2, 3, 4, 5].map(pointsFor)).toEqual([100, 200, 300, 400, 500])
  })
})

describe("reading this game's namespace off a card", () => {
  const attrs = (board: unknown) => readBoardAttrs(card({ id: 'a', attrs: { board } }))

  it('accepts a fully tagged card', () => {
    expect(readBoardAttrs(clue('a', 'Places', 1))).toEqual({ category: 'Places', difficulty: 1 })
  })

  it('ignores a plain flashcard', () => {
    expect(readBoardAttrs(card({ id: 'a' }))).toBeNull()
  })

  it('ignores a card whose attrs hold only other games', () => {
    expect(readBoardAttrs(card({ id: 'a', attrs: { nameThatMap: { region: 'x' } } }))).toBeNull()
  })

  it('rejects a half-tagged namespace either way round', () => {
    expect(attrs({ category: 'Places' })).toBeNull()
    expect(attrs({ difficulty: 3 })).toBeNull()
  })

  it('rejects a blank category, which would render a nameless column', () => {
    expect(attrs({ category: '   ', difficulty: 2 })).toBeNull()
  })

  it('rejects a tier off the board', () => {
    expect(attrs({ category: 'Places', difficulty: 0 })).toBeNull()
    expect(attrs({ category: 'Places', difficulty: 6 })).toBeNull()
    expect(attrs({ category: 'Places', difficulty: 2.5 })).toBeNull()
  })

  it('survives a namespace of the wrong shape entirely', () => {
    // The bag passes unknown namespaces through unvalidated, so `board` may be
    // anything at all by the time it gets here. A card that cannot be read is
    // simply not a clue — it must not take the board down.
    for (const junk of ['nonsense', 42, null, [], { category: 5, difficulty: 'x' }]) {
      expect(attrs(junk)).toBeNull()
    }
  })
})

describe('building the grid', () => {
  it('keeps categories in author order, not alphabetical', () => {
    const board = buildBoard([clue('a', 'Zeta', 1), clue('b', 'Alpha', 1)])
    expect(board.categories).toEqual(['Zeta', 'Alpha'])
  })

  it('scores the board from the tiers actually present', () => {
    const board = buildBoard([clue('a', 'X', 1), clue('b', 'X', 5)])
    expect(board.clueCount).toBe(2)
    expect(board.maxScore).toBe(600)
  })

  it('leaves untagged cards off the grid but keeps them in the deck', () => {
    const board = buildBoard([clue('a', 'X', 1), card({ id: 'b' })])
    expect(board.clueCount).toBe(1)
    expect(board.unplaced.map(c => c.id)).toEqual(['b'])
  })

  it('tolerates a board with holes', () => {
    const board = buildBoard([clue('a', 'X', 1), clue('b', 'X', 4)])
    expect(board.cells.get('X')?.get(1)?.card.id).toBe('a')
    expect(board.cells.get('X')?.get(2)).toBeUndefined()
    expect(board.cells.get('X')?.get(4)?.card.id).toBe('b')
  })

  it('gives a contested cell to the first clue and demotes the rest', () => {
    // Two clues at one category and tier is an authoring mistake with no right
    // answer. Silently showing the last would make the board depend on card
    // order in a way nobody can see.
    const board = buildBoard([clue('a', 'X', 1), clue('b', 'X', 1)])
    expect(board.cells.get('X')?.get(1)?.card.id).toBe('a')
    expect(board.unplaced.map(c => c.id)).toEqual(['b'])
    expect(board.maxScore).toBe(100)
  })

  it('treats categories differing only by surrounding space as one column', () => {
    const board = buildBoard([clue('a', 'Places', 1), clue('b', '  Places  ', 2)])
    expect(board.categories).toEqual(['Places'])
    expect(board.cells.get('Places')?.size).toBe(2)
  })
})

describe('playability', () => {
  const set = (cards: StudyCard[]): StudySetDetail => ({
    id: 's',
    title: 'T',
    description: null,
    published: false,
    cardCount: cards.length,
    isOwner: true,
    createdAt: 'x',
    updatedAt: 'x',
    cards
  })

  it('offers a board as soon as one clue qualifies', () => {
    expect(isPlayable(set([clue('a', 'X', 1), card({ id: 'b' })]))).toBe(true)
  })

  it('does not offer a board for a plain deck', () => {
    expect(isPlayable(set([card({ id: 'a' }), card({ id: 'b' })]))).toBe(false)
  })
})

describe('what is still missing', () => {
  it('says so when there is nothing to tag', () => {
    expect(missingForBoard([])).toMatch(/add some cards/i)
  })

  it('explains the whole deck is untagged', () => {
    expect(missingForBoard([card({ id: 'a' })])).toMatch(/category and a tier/i)
  })

  it('counts progress on a half-tagged deck', () => {
    const msg = missingForBoard([clue('a', 'X', 1), card({ id: 'b' }), card({ id: 'c' })])
    expect(msg).toContain('1 of 3')
    expect(msg).toContain('other 2')
  })

  it('is silent once every card is on the board', () => {
    expect(missingForBoard([clue('a', 'X', 1)])).toBeNull()
  })
})
