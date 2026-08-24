/**
 * The outbox is the difference between "the rating is a little wrong" and
 * "the rating is a little wrong forever".
 *
 * A failed answer leaves no trace anywhere — the game carries on, the reader
 * sees nothing, and the system has simply learnt one fact less than it should
 * have. That invisibility is the whole reason this is a queue rather than a
 * `.catch(() => undefined)`, and why its failure paths are pinned here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudyClient } from '../api/client'
import type { AttemptInput, QuestionRating } from '../api/types'
import {
  OUTBOX_LIMIT,
  clearHeldFor,
  enqueue,
  heldFor,
  indexRatings,
  readOutbox,
  recordAttempt,
  writeOutbox,
  type PendingAttempt
} from './attempts'

/** The node test environment has no localStorage, and the module's whole job
 *  is what it does with one. A Map is enough to be that. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear()
    }
  })
  return store
}

let store: Map<string, string>

beforeEach(() => {
  store = installStorage()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

const pending = (over: Partial<PendingAttempt> = {}): PendingAttempt => ({
  setId: 's1',
  game: 'drill',
  factId: 'f1',
  variantKey: 'answer<prompt>',
  result: 'got',
  ...over
})

const rating = (over: Partial<QuestionRating> = {}): QuestionRating => ({
  factId: 'f1',
  variantKey: 'answer<prompt>',
  global: 1200,
  local: 1200,
  globalPlays: 1,
  yourPlays: 1,
  ...over
})

/** Just enough client to be the one thing `recordAttempt` calls. */
const clientWith = (recordAttempts: ReturnType<typeof vi.fn>) =>
  ({ recordAttempts }) as unknown as StudyClient

describe('the queue', () => {
  it('round-trips what it was given', () => {
    enqueue(pending())
    expect(readOutbox()).toEqual([pending()])
  })

  it('reads as empty when there is nothing stored', () => {
    expect(readOutbox()).toEqual([])
  })

  it('survives a corrupt value rather than throwing on the next grade', () => {
    store.set('hadoku_study_attempt_outbox', 'not json at all')
    expect(readOutbox()).toEqual([])
  })

  it('drops only the entries it cannot read', () => {
    // A bundle older or newer than this one may have written a shape this does
    // not know. Losing one held answer beats losing the queue.
    store.set(
      'hadoku_study_attempt_outbox',
      JSON.stringify([pending(), { setId: 's1' }, pending({ factId: 'f2' })])
    )
    expect(readOutbox().map(entry => entry.factId)).toEqual(['f1', 'f2'])
  })

  it('drops the OLDEST when it overflows', () => {
    // Recent answers describe what you know now; a month-stale one is the
    // least useful thing in the queue.
    writeOutbox(Array.from({ length: OUTBOX_LIMIT + 10 }, (_, i) => pending({ factId: `f${i}` })))
    const held = readOutbox()
    expect(held).toHaveLength(OUTBOX_LIMIT)
    expect(held[held.length - 1].factId).toBe(`f${OUTBOX_LIMIT + 9}`)
    expect(held[0].factId).toBe('f10')
  })

  it('keeps one set’s held answers separate from another’s', () => {
    enqueue(pending({ setId: 's1' }))
    enqueue(pending({ setId: 's2' }))
    expect(heldFor('s1')).toHaveLength(1)
    clearHeldFor('s1')
    expect(heldFor('s1')).toEqual([])
    expect(heldFor('s2')).toHaveLength(1)
  })

  it('does not take the session down when storage refuses to write', () => {
    // Quota, or private-mode Safari. The answer is lost; the game is not.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: () => undefined
      }
    })
    expect(() => enqueue(pending())).not.toThrow()
  })
})

describe('recording an answer', () => {
  const attempt: AttemptInput = { factId: 'f1', variantKey: 'answer<prompt>', result: 'got' }

  it('sends nothing at all when the reader has no identity', async () => {
    const send = vi.fn()
    const result = await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: false },
      attempt
    )
    expect(result).toBeNull()
    expect(send).not.toHaveBeenCalled()
    // And nothing is queued either — a signed-out reader has nothing to flush
    // to later, so a queue would grow forever and never drain.
    expect(readOutbox()).toEqual([])
  })

  it('returns the new ratings on success', async () => {
    const send = vi.fn().mockResolvedValue([rating()])
    const result = await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    expect(result).toEqual([rating()])
    expect(send).toHaveBeenCalledWith('s1', 'drill', [attempt])
  })

  it('flushes what the set was holding on the SAME request, oldest first', async () => {
    // One round trip, and the server applies them in order — so a streak that
    // spans an offline patch is still a streak.
    enqueue(pending({ factId: 'held1' }))
    enqueue(pending({ factId: 'held2' }))
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    const [, , batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(batch.map(entry => entry.factId)).toEqual(['held1', 'held2', 'f1'])
    expect(readOutbox()).toEqual([])
  })

  it('leaves another set’s held answers alone', async () => {
    enqueue(pending({ setId: 's2', factId: 'other' }))
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    const [, , batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(batch).toHaveLength(1)
    expect(heldFor('s2')).toHaveLength(1)
  })

  it('queues the whole batch again when the send fails', async () => {
    enqueue(pending({ factId: 'held1' }))
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    expect(result).toBeNull()
    // Both the held one and the new one — the queue is cleared before the send
    // precisely so a failure re-queues once rather than duplicating the held
    // copies.
    expect(readOutbox().map(entry => entry.factId)).toEqual(['held1', 'f1'])
  })

  it('never rejects, because the caller is a grade handler mid-game', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      recordAttempt(
        { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
        attempt
      )
    ).resolves.toBeNull()
  })

  it('records which mode the answer came from', async () => {
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'board', enabled: true },
      attempt
    )
    expect(send).toHaveBeenCalledWith('s1', 'board', [attempt])
  })
})

describe('indexRatings', () => {
  it('keys by the id a game actually holds', () => {
    const index = indexRatings([rating({ factId: 'f9', variantKey: 'when<where>' })])
    expect(index.get('f9:when<where>')?.factId).toBe('f9')
  })
})
