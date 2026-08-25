/**
 * The registry is the seam the whole "more games later" plan rests on, so the
 * properties that make it a seam get asserted rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import { GAMES, findGame } from './registry'
import { asks, authored, detailSet, fact, flashcard } from '../testing/fixtures'

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

  it('gives every game a label', () => {
    for (const game of GAMES) expect(game.label.trim(), game.id).not.toBe('')
  })
})

describe('availability is decided from the content', () => {
  it('offers only the drill for a plain deck', () => {
    const available = GAMES.filter(g => g.availability(detailSet([flashcard('a')])).playable).map(
      g => g.id
    )
    expect(available).toEqual(['drill'])
  })

  it('offers both once a set asks more than one kind of question', () => {
    // A board's columns are asked slots, so board-ness is a property of the
    // CONTENT now — nothing has to be tagged for this game.
    const set = detailSet([flashcard('a'), asks('b', 'when'), asks('c', 'who')])
    const available = GAMES.filter(g => g.availability(set).playable).map(g => g.id)
    expect(available).toEqual(['drill', 'board'])
  })

  it('offers nothing for an empty set, and says why', () => {
    for (const game of GAMES) {
      const availability = game.availability(detailSet([]))
      expect(availability.playable, game.id).toBe(false)
      expect(availability.blocked, game.id).toBeTruthy()
    }
  })

  it('ignores a namespace belonging to some other game', () => {
    // A fact tagged for a future mode must not make the board think it is
    // playable — each game reads only its own key.
    const other = fact({ id: 'x', attrs: { nameThatMap: { region: 'x' } } })
    const available = GAMES.filter(g => g.availability(detailSet([other])).playable).map(g => g.id)
    expect(available).toEqual(['drill'])
  })
})
