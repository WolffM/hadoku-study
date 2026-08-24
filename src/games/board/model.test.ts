/**
 * Board-ness is derived on every render, so the derivation is the thing worth
 * pinning: it decides whether a set offers a game at all, and it has to give a
 * sane answer for the half-tagged sets that are the normal in-between state.
 */

import { describe, expect, it } from 'vitest'
import {
  TIERS,
  buildBoard,
  isPlayable,
  missingForBoard,
  pointsFor,
  readBoardAttrs,
  spread
} from './model'
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
  it('assigns rows by RANK, not by the seed tier stored on a question', () => {
    // The row is not a property of a question — it is where that question sits
    // against the others in its column. That is what lets a board respond to
    // play at all.
    const board = buildBoard(clueCards(['a', 'Places', 2], ['b', 'Places', 4]))
    expect(board.cells.get('Places')?.get(1)?.card.factId).toBe('a')
    expect(board.cells.get('Places')?.get(2)?.card.factId).toBe('b')
    // Not rows 2 and 4, which is where their seed tiers would have put them.
    expect(board.cells.get('Places')?.get(4)).toBeUndefined()
  })

  it('re-sorts when the ranking changes, which is the whole point', () => {
    const cards = clueCards(['a', 'Places', 1], ['b', 'Places', 5])
    // `a` was the easy one. Say the reader has been missing it and its rating
    // has overtaken `b`.
    const learned = new Map([
      [cards[0].id, 1500],
      [cards[1].id, 900]
    ])
    const board = buildBoard(cards, card => learned.get(card.id) ?? 0)
    expect(board.cells.get('Places')?.get(1)?.card.factId).toBe('b')
    expect(board.cells.get('Places')?.get(2)?.card.factId).toBe('a')
  })

  it('fills a short column from the bottom row up', () => {
    const board = buildBoard(clueCards(['a', 'Places', 3], ['b', 'Places', 4]))
    expect([...(board.cells.get('Places')?.keys() ?? [])]).toEqual([1, 2])
    expect(board.maxScore).toBe(300)
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

  it('asks a fact only ONCE across the whole board', () => {
    // "Where did Luther meet Charles V" and "who did Luther meet at Worms" are
    // the same fact wearing two hats. A fact asked four ways is normal content,
    // so this is enforced rather than left to the author.
    const board = buildBoard(cardsOf([authored('a', 'Places')]))
    expect(board.clueCount).toBe(1)
    expect(board.unplaced).toHaveLength(1)
    expect(board.unplaced[0].factId).toBe('a')
  })

  it('holds that rule across columns too', () => {
    // Unreachable today — attrs live on the FACT, so every variant of a fact
    // shares its category. It becomes reachable in phase 4, when a category is
    // a selector over the asked slot and one fact's questions genuinely land
    // in different columns. Built by hand here so the rule is pinned before
    // the content that needs it exists.
    const [placesCard, peopleCard] = cardsOf([authored('a', 'Places')])
    const board = buildBoard([
      placesCard,
      { ...peopleCard, attrs: { board: { category: 'People' } } }
    ])
    expect(board.clueCount).toBe(1)
    expect(board.categories).toEqual(['Places', 'People'])
  })

  it('spans a long column rather than taking its five easiest', () => {
    // Otherwise a category with twenty questions builds a board out of the
    // twenty per cent you already know, which is not a board.
    const many = clueCards(
      ...Array.from({ length: 9 }, (_, i): [string, string, number] => [`f${i}`, 'Places', 1])
    )
    const ranks = new Map(many.map((card, index) => [card.id, index]))
    const board = buildBoard(many, card => ranks.get(card.id) ?? 0)
    const placed = TIERS.map(tier => board.cells.get('Places')?.get(tier)?.card.factId)
    expect(placed).toEqual(['f0', 'f2', 'f4', 'f6', 'f8'])
    expect(board.unplaced).toHaveLength(4)
  })

  it('always fills five rows when there are five to fill', () => {
    // Rounding can collide on short lists — six questions into five rows — and
    // a silently four-row column would look like missing content.
    for (const count of [5, 6, 7, 8, 11, 25]) {
      const many = clueCards(
        ...Array.from({ length: count }, (_, i): [string, string, number] => [`f${i}`, 'C', 1])
      )
      const ranks = new Map(many.map((card, index) => [card.id, index]))
      const board = buildBoard(many, card => ranks.get(card.id) ?? 0)
      expect(board.clueCount, `${count} questions`).toBe(5)
    }
  })

  it('breaks a rating tie the same way every render', () => {
    // Two questions at the same rating must not swap places between renders —
    // a board that reshuffles under a thumb is worse than one ordered badly.
    const cards = clueCards(['a', 'Places', 3], ['b', 'Places', 3])
    const first = buildBoard(cards, () => 1200)
    const second = buildBoard(cards, () => 1200)
    expect(first.cells.get('Places')?.get(1)?.card.factId).toBe('a')
    expect(second.cells.get('Places')?.get(1)?.card.factId).toBe('a')
  })
})

describe('spread', () => {
  it('returns everything when there is nothing to drop', () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3])
  })

  it('keeps both ends, so the ladder still spans the range', () => {
    const picked = spread([0, 1, 2, 3, 4, 5, 6, 7, 8], 5)
    expect(picked[0]).toBe(0)
    expect(picked[picked.length - 1]).toBe(8)
  })

  it('never returns duplicates', () => {
    for (let n = 5; n <= 30; n += 1) {
      const picked = spread(
        Array.from({ length: n }, (_, i) => i),
        5
      )
      expect(new Set(picked).size, `${n} items`).toBe(5)
    }
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
