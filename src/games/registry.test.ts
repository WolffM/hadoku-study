/**
 * The registry is the seam the whole "more games later" plan rests on, so the
 * properties that make it a seam get asserted rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import { GAMES, findGame } from './registry'
import type { StudyCard, StudySetDetail } from '../api/types'

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

const plain = { id: 'a', front: 'f', back: 'b' }
const clue = {
  id: 'c',
  front: 'f',
  back: 'b',
  attrs: { board: { category: 'Places', difficulty: 2 } }
}

describe('the registry', () => {
  it('gives every game a unique id, since it doubles as the URL and attrs key', () => {
    const ids = GAMES.map(game => game.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves a known id and refuses an unknown one', () => {
    expect(findGame('board')?.id).toBe('board')
    expect(findGame('drill')?.id).toBe('drill')
    // An old link to a retired game must land on the set page, not a blank one.
    expect(findGame('pictionary')).toBeNull()
    expect(findGame(null)).toBeNull()
  })

  it('offers the drill first, so it stays the default thing to do with a set', () => {
    expect(GAMES[0].id).toBe('drill')
  })

  it('gives every game a label and a blurb', () => {
    // The set page shows these side by side as a CHOICE. A game that ships
    // without a blurb renders as a bare verb next to a described one, which
    // makes the reader guess what they are picking.
    for (const game of GAMES) {
      expect(game.label.trim(), game.id).not.toBe('')
      expect(game.blurb.trim(), game.id).not.toBe('')
    }
  })
})

describe('availability is decided from the cards', () => {
  it('offers only the drill for a plain deck', () => {
    const available = GAMES.filter(g => g.availability(set([plain])).playable).map(g => g.id)
    expect(available).toEqual(['drill'])
  })

  it('offers both once a card carries board attrs', () => {
    const available = GAMES.filter(g => g.availability(set([plain, clue])).playable).map(g => g.id)
    expect(available).toEqual(['drill', 'board'])
  })

  it('offers nothing for an empty set, and says why', () => {
    for (const game of GAMES) {
      const availability = game.availability(set([]))
      expect(availability.playable, game.id).toBe(false)
      expect(availability.blocked, game.id).toBeTruthy()
    }
  })

  it('ignores a namespace belonging to some other game', () => {
    // A card tagged for a future mode must not make the board think it is
    // playable — each game reads only its own key.
    const other = { id: 'x', front: 'f', back: 'b', attrs: { nameThatMap: { region: 'x' } } }
    const available = GAMES.filter(g => g.availability(set([other])).playable).map(g => g.id)
    expect(available).toEqual(['drill'])
  })

  it('summarises what you are about to play', () => {
    const board = findGame('board')
    expect(board?.availability(set([clue])).summary).toContain('1 clue')
    expect(board?.availability(set([clue])).summary).toContain('200 points')
  })
})
