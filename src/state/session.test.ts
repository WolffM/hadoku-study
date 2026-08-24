/**
 * The recap is the only place a reader ever sees a rating, so which number it
 * shows matters more than usual.
 *
 * Two of these guard against the obvious-but-wrong version. The drill re-queues
 * a missed question until you get it, so a recap built from the LAST outcome of
 * each question would report a clean sweep of every completed pass — including
 * the ones you fought through.
 */

import { describe, expect, it } from 'vitest'
import {
  DRIFT_THRESHOLD,
  REVIEW_LIMIT,
  driftFromSeed,
  noteAnswer,
  recap,
  seedRatingFor,
  type Movement
} from './session'
import type { QuestionRatingChange } from '../api/types'
import { toPlayCards } from '../model/playCards'
import { asks } from '../testing/fixtures'

const card = (id: string) => toPlayCards([asks(id, 'when')])[0]

const change = (id: string, localDelta: number, local = 1200): QuestionRatingChange => ({
  factId: id,
  variantKey: 'when<>',
  global: local,
  local,
  globalPlays: 1,
  yourPlays: 1,
  globalDelta: localDelta,
  localDelta
})

describe('folding an answer into the log', () => {
  it('records what was answered and where it ended up', () => {
    const log = noteAnswer([], card('a'), 'missed', [change('a', 20, 1220)])
    expect(log).toHaveLength(1)
    expect(log[0].result).toBe('missed')
    expect(log[0].local).toBe(1220)
    expect(log[0].localDelta).toBe(20)
  })

  it('keeps the FIRST outcome when a question comes round again', () => {
    // The drill re-queues a missed question until you get it. Keeping the last
    // outcome would report every completed pass as flawless.
    let log = noteAnswer([], card('a'), 'missed', [change('a', 20, 1220)])
    log = noteAnswer(log, card('a'), 'got', [change('a', -18, 1202)])
    expect(log).toHaveLength(1)
    expect(log[0].result).toBe('missed')
  })

  it('accumulates the movement across repeats, and keeps the latest rating', () => {
    let log = noteAnswer([], card('a'), 'missed', [change('a', 20, 1220)])
    log = noteAnswer(log, card('a'), 'missed', [change('a', 30, 1250)])
    expect(log[0].localDelta).toBe(50)
    expect(log[0].local).toBe(1250)
  })

  it('still records the answer when nothing reached the server', () => {
    // Signed out, or offline. The recap's job is to say what you got wrong,
    // which is true whether or not a rating moved.
    const log = noteAnswer([], card('a'), 'missed', null)
    expect(log[0].result).toBe('missed')
    expect(log[0].local).toBeNull()
    expect(log[0].localDelta).toBe(0)
  })

  it('does not lose a known rating to a later failed send', () => {
    let log = noteAnswer([], card('a'), 'missed', [change('a', 20, 1220)])
    log = noteAnswer(log, card('a'), 'got', null)
    expect(log[0].local).toBe(1220)
  })

  it('ignores changes belonging to other questions', () => {
    // A flushed outbox replays answers from an earlier sitting, and those
    // ratings come back in the same response.
    const log = noteAnswer([], card('a'), 'got', [change('b', 40), change('a', -12, 1188)])
    expect(log[0].local).toBe(1188)
    expect(log[0].localDelta).toBe(-12)
  })

  it('keeps questions in the order they were answered', () => {
    let log = noteAnswer([], card('a'), 'got', null)
    log = noteAnswer(log, card('b'), 'got', null)
    log = noteAnswer(log, card('a'), 'missed', null)
    expect(log.map(m => m.card.factId)).toEqual(['a', 'b'])
  })
})

describe('the recap', () => {
  const missedLog = (specs: [string, number][]): Movement[] =>
    specs.reduce<Movement[]>(
      (log, [id, delta]) => noteAnswer(log, card(id), 'missed', [change(id, delta)]),
      []
    )

  it('counts what went which way', () => {
    let log = noteAnswer([], card('a'), 'got', null)
    log = noteAnswer(log, card('b'), 'missed', null)
    const result = recap(log)
    expect(result.got).toBe(1)
    expect(result.missed).toBe(1)
  })

  it('names the missed ones, biggest riser first', () => {
    // What moved most is what this sitting learnt most about, and what you
    // would come back to.
    const result = recap(
      missedLog([
        ['small', 4],
        ['big', 40],
        ['mid', 20]
      ])
    )
    expect(result.review.map(m => m.card.factId)).toEqual(['big', 'mid', 'small'])
  })

  it('has nothing to review after a clean sitting, which is the point', () => {
    const log = noteAnswer([], card('a'), 'got', [change('a', -20)])
    expect(recap(log).review).toEqual([])
  })

  it('stops naming names past a handful', () => {
    const many = Array.from({ length: 12 }, (_, i): [string, number] => [`f${i}`, i])
    expect(recap(missedLog(many)).review).toHaveLength(REVIEW_LIMIT)
  })

  it('knows when no rating moved, so the recap can stay quiet about them', () => {
    const offline = noteAnswer([], card('a'), 'missed', null)
    expect(recap(offline).rated).toBe(false)
    expect(recap(missedLog([['a', 20]])).rated).toBe(true)
  })

  it('handles a sitting nobody played', () => {
    expect(recap([])).toEqual({ got: 0, missed: 0, review: [], rated: false })
  })
})

describe('drift from where the author put it', () => {
  it('maps the five tiers onto the rating the server seeds', () => {
    expect([1, 2, 3, 4, 5].map(seedRatingFor)).toEqual([1000, 1100, 1200, 1300, 1400])
  })

  it('says nothing about a rating that has barely wandered', () => {
    // Ratings drift by a few points constantly. Reporting that as news trains
    // people to ignore the badge.
    expect(driftFromSeed(1220, 1200)).toBeNull()
    expect(driftFromSeed(1200 - DRIFT_THRESHOLD + 1, 1200)).toBeNull()
  })

  it('reports a real disagreement with the author, signed', () => {
    expect(driftFromSeed(1400, 1200)).toBe(200)
    expect(driftFromSeed(1000, 1200)).toBe(-200)
  })
})
