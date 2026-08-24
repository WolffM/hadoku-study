/**
 * The registry is the seam the whole "more games later" plan rests on, so the
 * properties that make it a seam get asserted rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import { GAMES, findGame } from './registry'
import { authored, clue, detailSet, fact, flashcard } from '../testing/fixtures'

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

describe('availability is decided from the content', () => {
  it('offers only the drill for a plain deck', () => {
    const available = GAMES.filter(g => g.availability(detailSet([flashcard('a')])).playable).map(
      g => g.id
    )
    expect(available).toEqual(['drill'])
  })

  it('offers both once a fact carries a board category', () => {
    const set = detailSet([flashcard('a'), clue('c', 'Places', 2)])
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

  it('summarises what you are about to play', () => {
    const set = detailSet([clue('c', 'Places', 2)])
    expect(findGame('board')?.availability(set).summary).toContain('1 clue')
    expect(findGame('board')?.availability(set).summary).toContain('200 points')
  })

  it('counts questions rather than facts when the drill offers a set', () => {
    // A fact asked twice is two things to get right. Reporting the fact count
    // would understate every authored set by exactly the amount of authoring
    // that went into it.
    const summary = findGame('drill')?.availability(detailSet([authored('a')])).summary
    expect(summary).toContain('2 questions')
    expect(summary).toContain('1 facts')
  })

  it('drops the fact count when it says nothing new', () => {
    // A set imported straight off v1 has one question per fact, and "25
    // questions from 25 facts" reads as the system explaining itself rather
    // than telling you anything about the set.
    const summary = findGame('drill')?.availability(detailSet([flashcard('a')])).summary
    expect(summary).toBe('1 question')
  })
})
