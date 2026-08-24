/**
 * Dealing a board.
 *
 * The rule with teeth is that **one fact may be asked only once per board**.
 * Columns are asked SLOTS, so one fact's questions scatter across several of
 * them — and a board that took the obvious pick for each column independently
 * would routinely ask the same fact twice, or strand a column whose few
 * options had all been claimed. These tests are what say the matching actually
 * solves that rather than usually getting away with it.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLUMNS,
  MIN_COLUMNS,
  buildBoard,
  candidateCategories,
  chooseCategories,
  labelFor,
  missingForBoard,
  pointsFor
} from './model'
import { toPlayCards } from '../../model/playCards'
import { asks, authored, fact, flashcard } from '../../testing/fixtures'

const cardsOf = (facts: Parameters<typeof toPlayCards>[0]) => toPlayCards(facts)

/** Every clue on the board, flattened. */
const placed = (board: ReturnType<typeof buildBoard>) =>
  board.columns.flatMap(column => [...column.cells.values()])

describe('points', () => {
  it('map a row to a board value', () => {
    expect([1, 2, 3, 4, 5].map(pointsFor)).toEqual([100, 200, 300, 400, 500])
  })
})

describe('what a column is', () => {
  it('is the slot its questions answer', () => {
    const cards = cardsOf([asks('a', 'when'), asks('b', 'when'), asks('c', 'where')])
    const found = candidateCategories(cards)
    expect(found.map(c => c.slot)).toEqual(['when', 'where'])
    expect(found[0].factCount).toBe(2)
  })

  it('reads a known slot as a category, and an unknown one as itself', () => {
    expect(labelFor('when')).toBe('Name that year')
    expect(labelFor('why')).toBe('Why it mattered')
    // The GW2 case: a set with a `map` slot should say "Map", not guess.
    expect(labelFor('map')).toBe('Map')
    expect(labelFor('screen-shot')).toBe('Screen shot')
  })

  it('refuses the two halves of a flashcard as categories', () => {
    // A column headed "Answer" is the whole deck with a number on it.
    expect(candidateCategories(cardsOf([flashcard('a'), flashcard('b')]))).toEqual([])
  })

  it('orders columns by how many FACTS could fill them', () => {
    // Not by question count: one fact may be asked only once per board, so
    // three questions over one fact can still only fill one cell.
    const cards = cardsOf([asks('a', 'why', 3, { also: ['when', 'who'] }), asks('b', 'when')])
    expect(candidateCategories(cards).map(c => c.slot)).toEqual(['when', 'who', 'why'])
  })
})

describe('choosing the columns', () => {
  const many = (slots: string[]) =>
    candidateCategories(cardsOf(slots.map((slot, i) => asks(`f${i}`, slot))))

  it('takes the richest', () => {
    const chosen = chooseCategories(many(['when', 'when', 'who', 'where']), 2)
    expect(chosen.map(c => c.slot)).toEqual(['when', 'where'])
  })

  it('guarantees a column you have to explain, when the set has one', () => {
    // A board of names and years is a quiz you can win without understanding
    // anything, which is the opposite of the point.
    const cards = cardsOf([
      asks('a', 'when'),
      asks('b', 'when'),
      asks('c', 'who'),
      asks('d', 'why', 3, { open: true })
    ])
    const chosen = chooseCategories(candidateCategories(cards), 2)
    expect(chosen.some(c => c.hasOpen)).toBe(true)
  })

  it('displaces the weakest column to make room for it, not the strongest', () => {
    const cards = cardsOf([
      asks('a', 'when'),
      asks('b', 'when'),
      asks('c', 'when'),
      asks('d', 'who'),
      asks('e', 'why', 3, { open: true })
    ])
    const chosen = chooseCategories(candidateCategories(cards), 2)
    expect(chosen.map(c => c.slot)).toEqual(['when', 'why'])
  })

  it('asks for nothing when there is nothing to ask', () => {
    expect(chooseCategories([], DEFAULT_COLUMNS)).toEqual([])
  })
})

describe('dealing the grid', () => {
  it('fills four columns of five from a set with enough facts', () => {
    const slots = ['when', 'who', 'where', 'why']
    const facts = slots.flatMap(slot =>
      Array.from({ length: 5 }, (_, i) => asks(`${slot}${i}`, slot, i + 1))
    )
    const board = buildBoard(cardsOf(facts))
    expect(board.columns).toHaveLength(4)
    expect(board.clueCount).toBe(20)
    expect(board.maxScore).toBe(4 * 1500)
  })

  it('never asks one fact twice, even across columns', () => {
    // The whole rule. A fact asked four ways offers itself to four columns.
    const facts = Array.from({ length: 8 }, (_, i) =>
      asks(`f${i}`, 'when', 3, { also: ['who', 'where', 'why'] })
    )
    const board = buildBoard(cardsOf(facts))
    const factIds = placed(board).map(clue => clue.card.factId)
    expect(new Set(factIds).size).toBe(factIds.length)
  })

  it('finds a full board where picking each column independently would not', () => {
    // Two columns, two rows. Fact `shared` can fill either; `onlyWhen` and
    // `onlyWho` can each fill one. A greedy pass that let `when` take both of
    // its options would strand `who`; matching makes it give one back.
    const cards = cardsOf([
      asks('shared', 'when', 1, { also: ['who'] }),
      asks('onlyWhen', 'when', 2),
      asks('onlyWho', 'who', 2)
    ])
    const board = buildBoard(cards, { columns: 2, rows: 2 })
    const bySlot = Object.fromEntries(board.columns.map(c => [c.slot, c.cells.size]))
    expect(bySlot).toEqual({ when: 2, who: 1 })
    expect(new Set(placed(board).map(c => c.card.factId)).size).toBe(3)
  })

  it('orders each column by rank, easiest at the top', () => {
    // A second slot so the set qualifies as a board at all; `columns: 1` then
    // isolates the richest column, which is the one under test.
    const facts = [
      asks('hard', 'when', 5),
      asks('easy', 'when', 1),
      asks('mid', 'when', 3),
      asks('other', 'who')
    ]
    const board = buildBoard(cardsOf(facts), { columns: 1 })
    const column = board.columns[0]
    expect([1, 2, 3].map(row => column.cells.get(row)?.card.factId)).toEqual([
      'easy',
      'mid',
      'hard'
    ])
  })

  it('re-sorts when the ranking changes, which is why a board responds to play', () => {
    const cards = cardsOf([asks('a', 'when', 1), asks('b', 'when', 5), asks('other', 'who')])
    const learned = new Map(cards.map(card => [card.id, card.factId === 'a' ? 1500 : 900]))
    const board = buildBoard(cards, { columns: 1, rankBy: card => learned.get(card.id) ?? 0 })
    expect(board.columns[0].cells.get(1)?.card.factId).toBe('b')
    expect(board.columns[0].cells.get(2)?.card.factId).toBe('a')
  })

  it('spans a long column rather than taking its five easiest', () => {
    const facts = [
      ...Array.from({ length: 15 }, (_, i) => asks(`f${i}`, 'when', 3)),
      asks('other', 'who')
    ]
    const ranks = new Map(facts.map((f, i) => [f.id, i]))
    const board = buildBoard(cardsOf(facts), {
      columns: 1,
      rankBy: card => ranks.get(card.factId) ?? 0
    })
    const chosen = [...board.columns[0].cells.values()].map(c => ranks.get(c.card.factId) ?? 0)
    expect(chosen[0]).toBe(0)
    expect(chosen[chosen.length - 1]).toBe(14)
  })

  it('shrinks rows before columns when a set is thin', () => {
    // Four angles of attack matters more than the full ladder.
    const cards = cardsOf([
      asks('a', 'when'),
      asks('b', 'who'),
      asks('c', 'where'),
      asks('d', 'why', 3, { open: true })
    ])
    const board = buildBoard(cards)
    expect(board.columns).toHaveLength(4)
    expect(board.columns.every(column => column.cells.size === 1)).toBe(true)
    expect(board.clueCount).toBe(4)
  })

  it('leaves everything it could not place in the deck', () => {
    const facts = [
      ...Array.from({ length: 9 }, (_, i) => asks(`f${i}`, 'when', 3)),
      asks('other', 'who')
    ]
    const cards = cardsOf(facts)
    const board = buildBoard(cards, { columns: 1, rows: 5 })
    expect(board.clueCount).toBe(5)
    expect(board.unplaced).toHaveLength(cards.length - 5)
  })

  it('deals the same board twice from the same set', () => {
    // A grid that reshuffled between renders would be worse than one ordered
    // badly.
    const facts = Array.from({ length: 12 }, (_, i) => asks(`f${i}`, i % 2 ? 'when' : 'who', 3))
    const a = buildBoard(cardsOf(facts))
    const b = buildBoard(cardsOf(facts))
    expect(placed(a).map(c => c.card.id)).toEqual(placed(b).map(c => c.card.id))
  })
})

describe('whether a board can be dealt at all', () => {
  // The real gate is whether `buildBoard` places anything — which is what the
  // game definition asks. A separate `isPlayable` predicate answering the same
  // question from the same inputs was a second answer waiting to disagree.
  it('needs more than one kind of question', () => {
    expect(buildBoard(cardsOf([asks('a', 'when'), asks('b', 'when')])).clueCount).toBe(0)
    expect(buildBoard(cardsOf([asks('a', 'when'), asks('b', 'who')])).clueCount).toBe(2)
  })

  it('deals nothing from a deck of flashcards', () => {
    expect(buildBoard(cardsOf([flashcard('a'), flashcard('b')])).clueCount).toBe(0)
  })

  it('deals from a set with real slots', () => {
    expect(buildBoard(cardsOf([authored('a'), authored('b')])).clueCount).toBeGreaterThan(0)
  })
})

describe('telling the author what is missing', () => {
  it('says nothing when a board can be dealt', () => {
    expect(missingForBoard(cardsOf([asks('a', 'when'), asks('b', 'who')]))).toBeNull()
  })

  it('asks for content before anything else', () => {
    expect(missingForBoard([])).toContain('facts')
  })

  it('explains what a flashcard deck is missing', () => {
    const message = missingForBoard(cardsOf([flashcard('a')]))
    expect(message).toContain('slots')
  })

  it('says when there is only one kind of question', () => {
    const message = missingForBoard(cardsOf([asks('a', 'when'), asks('b', 'when')]))
    expect(message).toContain(String(MIN_COLUMNS))
    expect(message).toContain('Name that year')
  })

  it('ignores a namespace belonging to some other game', () => {
    // Nothing this game ships reads a namespace any more — columns come from
    // the content — so a fact tagged for a future mode is just a flashcard.
    const other = fact({ id: 'x', attrs: { nameThatMap: { region: 'x' } } })
    expect(buildBoard(cardsOf([other])).clueCount).toBe(0)
  })
})
