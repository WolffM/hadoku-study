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
  it('is the ARCHETYPE its facts belong to, not the slot they answer', () => {
    // The change in one test. All three facts ask a different mix of slots;
    // what decides the column is which archetype the author put them in.
    const cards = cardsOf([
      asks('a', 'when', 3, { archetype: 'event' }),
      asks('b', 'where', 3, { archetype: 'event' }),
      asks('c', 'citation', 3, { archetype: 'scripture' })
    ])
    const found = candidateCategories(cards, [
      { name: 'event', label: 'Who, where, when', ask: ['when', 'where'] },
      { name: 'scripture', label: 'Biblical references', ask: ['citation'] }
    ])
    expect(found.map(c => c.key)).toEqual(['event', 'scripture'])
    expect(found.map(c => c.label)).toEqual(['Who, where, when', 'Biblical references'])
    expect(found[0].factCount).toBe(2)
  })

  it('puts a set that declares no archetypes in ONE implicit column', () => {
    // The v2 case. A one-column board is a legitimate board.
    const cards = cardsOf([asks('a', 'when'), asks('b', 'where'), asks('c', 'who')])
    const found = candidateCategories(cards)
    expect(found).toHaveLength(1)
    expect(found[0].factCount).toBe(3)
  })

  it('never scatters one fact across two columns', () => {
    // The defect this whole model exists to fix: a fact asked four ways used
    // to appear as a candidate in four different columns.
    const cards = cardsOf([
      asks('a', 'who', 3, { also: ['what', 'when', 'where'], archetype: 'event' })
    ])
    const found = candidateCategories(cards, [
      { name: 'event', label: 'Events', ask: ['who', 'what', 'when', 'where'] }
    ])
    expect(found).toHaveLength(1)
    expect(found[0].factCount).toBe(1)
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
    const cards = cardsOf([
      asks('a', 'why', 3, { also: ['when', 'who'], archetype: 'wide' }),
      asks('b', 'when', 3, { archetype: 'narrow' }),
      asks('c', 'when', 3, { archetype: 'narrow' })
    ])
    expect(candidateCategories(cards).map(c => c.key)).toEqual(['narrow', 'wide'])
  })
})

describe('choosing the columns', () => {
  /** One fact per entry, each in the named archetype. */
  const many = (archetypes: string[]) =>
    candidateCategories(
      cardsOf(archetypes.map((name, i) => asks(`f${i}`, 'when', 3, { archetype: name })))
    )

  it('takes the richest', () => {
    const chosen = chooseCategories(many(['a', 'a', 'c', 'b']), 2)
    expect(chosen.map(c => c.key)).toEqual(['a', 'b'])
  })

  it('guarantees a column you have to explain, when the set has one', () => {
    // A board of names and years is a quiz you can win without understanding
    // anything, which is the opposite of the point.
    const cards = cardsOf([
      asks('a', 'when', 3, { archetype: 'dates' }),
      asks('b', 'when', 3, { archetype: 'dates' }),
      asks('c', 'who', 3, { archetype: 'people' }),
      asks('d', 'why', 3, { open: true, archetype: 'reasons' })
    ])
    const chosen = chooseCategories(candidateCategories(cards), 2)
    expect(chosen.some(c => c.hasOpen)).toBe(true)
  })

  it('displaces the weakest column to make room for it, not the strongest', () => {
    const cards = cardsOf([
      asks('a', 'when', 3, { archetype: 'dates' }),
      asks('b', 'when', 3, { archetype: 'dates' }),
      asks('c', 'when', 3, { archetype: 'dates' }),
      asks('d', 'who', 3, { archetype: 'people' }),
      asks('e', 'why', 3, { open: true, archetype: 'reasons' })
    ])
    const chosen = chooseCategories(candidateCategories(cards), 2)
    expect(chosen.map(c => c.key)).toEqual(['dates', 'reasons'])
  })

  it('asks for nothing when there is nothing to ask', () => {
    expect(chooseCategories([], DEFAULT_COLUMNS)).toEqual([])
  })
})

describe('dealing the grid', () => {
  it('fills four columns of five from a set with enough facts', () => {
    const columns = ['events', 'people', 'places', 'reasons']
    const facts = columns.flatMap(name =>
      Array.from({ length: 5 }, (_, i) => asks(`${name}${i}`, 'when', i + 1, { archetype: name }))
    )
    const board = buildBoard(cardsOf(facts))
    expect(board.columns).toHaveLength(4)
    expect(board.clueCount).toBe(20)
    expect(board.maxScore).toBe(4 * 1500)
  })

  it('never asks one fact twice, even across columns', () => {
    // The rule survives the model change, and now holds by construction: one
    // fact belongs to one archetype, so columns cannot compete for it. Worth
    // asserting precisely BECAUSE it stopped being enforced by the generator
    // and started being enforced by the shape of the data.
    const facts = Array.from({ length: 8 }, (_, i) =>
      asks(`f${i}`, 'when', 3, { also: ['who', 'where', 'why'], archetype: `a${i % 3}` })
    )
    const board = buildBoard(cardsOf(facts))
    const factIds = placed(board).map(clue => clue.card.factId)
    expect(new Set(factIds).size).toBe(factIds.length)
  })

  it('finds a full board where picking each column independently would not', () => {
    // Kept as a REGRESSION test rather than for its original reason. It used
    // to describe a fact that could fill either of two columns, which an
    // archetype no longer permits — the matching in generate.ts exists for
    // that case and is now unreachable. What it still pins is that two
    // columns of two deal from disjoint pools without stranding either.
    const cards = cardsOf([
      asks('whenA', 'when', 1, { archetype: 'dates' }),
      asks('whenB', 'when', 2, { archetype: 'dates' }),
      asks('whoA', 'who', 2, { archetype: 'people' })
    ])
    const board = buildBoard(cards, { columns: 2, rows: 2 })
    const byColumn = Object.fromEntries(board.columns.map(c => [c.slot, c.cells.size]))
    expect(byColumn).toEqual({ dates: 2, people: 1 })
    expect(new Set(placed(board).map(c => c.card.factId)).size).toBe(3)
  })

  it('orders each column by rank, easiest at the top', () => {
    const facts = [
      asks('hard', 'when', 5, { archetype: 'dates' }),
      asks('easy', 'when', 1, { archetype: 'dates' }),
      asks('mid', 'when', 3, { archetype: 'dates' }),
      asks('other', 'who', 3, { archetype: 'people' })
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
    const cards = cardsOf([
      asks('a', 'when', 1, { archetype: 'dates' }),
      asks('b', 'when', 5, { archetype: 'dates' }),
      asks('other', 'who', 3, { archetype: 'people' })
    ])
    const learned = new Map(cards.map(card => [card.id, card.factId === 'a' ? 1500 : 900]))
    const board = buildBoard(cards, { columns: 1, rankBy: card => learned.get(card.id) ?? 0 })
    expect(board.columns[0].cells.get(1)?.card.factId).toBe('b')
    expect(board.columns[0].cells.get(2)?.card.factId).toBe('a')
  })

  it('spans a long column rather than taking its five easiest', () => {
    const facts = [
      ...Array.from({ length: 15 }, (_, i) => asks(`f${i}`, 'when', 3, { archetype: 'dates' })),
      asks('other', 'who', 3, { archetype: 'people' })
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
      asks('a', 'when', 3, { archetype: 'dates' }),
      asks('b', 'who', 3, { archetype: 'people' }),
      asks('c', 'where', 3, { archetype: 'places' }),
      asks('d', 'why', 3, { open: true, archetype: 'reasons' })
    ])
    const board = buildBoard(cards)
    expect(board.columns).toHaveLength(4)
    expect(board.columns.every(column => column.cells.size === 1)).toBe(true)
    expect(board.clueCount).toBe(4)
  })

  it('leaves everything it could not place in the deck', () => {
    const facts = [
      ...Array.from({ length: 9 }, (_, i) => asks(`f${i}`, 'when', 3, { archetype: 'dates' })),
      asks('other', 'who', 3, { archetype: 'people' })
    ]
    const cards = cardsOf(facts)
    const board = buildBoard(cards, { columns: 1, rows: 5 })
    expect(board.clueCount).toBe(5)
    expect(board.unplaced).toHaveLength(cards.length - 5)
  })

  it('deals the same board twice from the same set', () => {
    // A grid that reshuffled between renders would be worse than one ordered
    // badly.
    const facts = Array.from({ length: 12 }, (_, i) =>
      asks(`f${i}`, 'when', 3, { archetype: i % 2 ? 'dates' : 'people' })
    )
    const a = buildBoard(cardsOf(facts))
    const b = buildBoard(cardsOf(facts))
    expect(placed(a).map(c => c.card.id)).toEqual(placed(b).map(c => c.card.id))
  })
})

describe('whether a board can be dealt at all', () => {
  // The real gate is whether `buildBoard` places anything — which is what the
  // game definition asks. A separate `isPlayable` predicate answering the same
  // question from the same inputs was a second answer waiting to disagree.
  it('deals a ONE-column board, because a single archetype is a real board', () => {
    // This used to require two kinds of question and refuse otherwise. A set
    // with one archetype now plays as one column — thin, but honest, and the
    // author can add a second when they have one.
    const one = buildBoard(
      cardsOf([
        asks('a', 'when', 3, { archetype: 'dates' }),
        asks('b', 'when', 3, { archetype: 'dates' })
      ])
    )
    expect(one.columns).toHaveLength(1)
    expect(one.clueCount).toBe(2)
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

  it('says nothing is missing when there is one archetype', () => {
    // It used to demand a second kind of question here. One archetype is one
    // column, which is a board — so there is nothing to report, and reporting
    // something would be telling the author to fix what is not broken.
    expect(missingForBoard(cardsOf([asks('a', 'when', 3, { archetype: 'dates' })]))).toBeNull()
  })

  it('ignores a namespace belonging to some other game', () => {
    // Nothing this game ships reads a namespace any more — columns come from
    // the content — so a fact tagged for a future mode is just a flashcard.
    const other = fact({ id: 'x', attrs: { nameThatMap: { region: 'x' } } })
    expect(buildBoard(cardsOf([other])).clueCount).toBe(0)
  })
})
