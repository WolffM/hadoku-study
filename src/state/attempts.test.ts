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
import workerDb from '../../worker/src/db.ts?raw'
import type { StudyClient } from '../api/client'
import type { AttemptInput, QuestionRating } from '../api/types'
import {
  MAX_PER_SEND,
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

let nextId = 0
const pending = (over: Partial<PendingAttempt> = {}): PendingAttempt => ({
  attemptId: `attempt-${++nextId}`,
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

describe('the send cap', () => {
  it('matches the cap the server actually enforces', () => {
    // Two constants, two packages, and the client's copy is only correct while
    // it equals the server's. If they drift the client sends a batch the
    // schema rejects, every flush 400s, and — since a rejected send clears
    // nothing — the reader's outbox wedges permanently with nothing to see.
    //
    // Read as TEXT (`?raw`) rather than imported as a module: importing worker
    // source would pull a file full of D1 types into the UI's lint and type
    // projects, where it resolves to `error` and fails the build. A regex over
    // the declaration costs nothing and fails just as loudly if the server's
    // number moves.
    const declared = /MAX_ATTEMPTS_PER_REQUEST\s*=\s*(\d+)/.exec(workerDb)
    expect(declared, 'MAX_ATTEMPTS_PER_REQUEST not found in worker/src/db.ts').not.toBeNull()
    expect(MAX_PER_SEND).toBe(Number(declared?.[1]))
  })

  it('holds more than it sends, so a backlog survives to drain', () => {
    expect(OUTBOX_LIMIT).toBeGreaterThan(MAX_PER_SEND)
  })
})

describe('the queue', () => {
  it('round-trips what it was given', () => {
    const entry = pending()
    enqueue(entry)
    expect(readOutbox()).toEqual([entry])
  })

  it('repairs an entry queued before ids existed, and PERSISTS the repair', () => {
    // The bundle that first shipped queueing wrote entries with no attemptId.
    // Those are real graded answers; rejecting them on a schema bump would be
    // the loss this module exists to prevent. The id must also stick — one
    // invented afresh on every read would never match what a send cleared, so
    // the entry would be resent for ever.
    const { attemptId: _omitted, ...legacy } = pending()
    store.set('hadoku_study_attempt_outbox', JSON.stringify([legacy]))

    const first = readOutbox()
    expect(first).toHaveLength(1)
    expect(first[0].attemptId).toEqual(expect.any(String))
    expect(first[0].factId).toBe('f1')
    expect(readOutbox()[0].attemptId).toBe(first[0].attemptId)
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

  it('holds the answer when the reader has no identity, rather than dropping it', async () => {
    const send = vi.fn()
    const result = await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: false },
      attempt
    )
    expect(result).toBeNull()
    expect(send).not.toHaveBeenCalled()
    // This used to assert the answer was DISCARDED, on the reasoning that a
    // signed-out queue "would grow forever and never drain". It is bounded by
    // OUTBOX_LIMIT either way, and signing in is precisely how it drains.
    expect(readOutbox()).toMatchObject([{ ...attempt, setId: 's1', game: 'drill' }])
  })

  it('sends what was graded before sign-in on the first enabled send', async () => {
    // The case the drop was losing: play, then sign in. Both answers land, and
    // the pre-sign-in one comes first because it happened first.
    await recordAttempt(
      { client: clientWith(vi.fn()), setId: 's1', game: 'drill', enabled: false },
      { factId: 'before', variantKey: 'answer<prompt>', result: 'missed' }
    )
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    const [, , batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(batch.map(entry => entry.factId)).toEqual(['before', 'f1'])
    expect(readOutbox()).toEqual([])
  })

  it('holds a disabled answer per set, leaving another set\u2019s alone', async () => {
    await recordAttempt(
      { client: clientWith(vi.fn()), setId: 's2', game: 'drill', enabled: false },
      attempt
    )
    expect(heldFor('s1')).toHaveLength(0)
    expect(heldFor('s2')).toHaveLength(1)
  })

  it('writes the answer down BEFORE attempting to send it', async () => {
    // The write-ahead guarantee, observed at the one moment it matters: while
    // the request is in flight. A tab killed here must still hold the answer.
    let outboxDuringFlight: number | null = null
    const send = vi.fn().mockImplementation(() => {
      outboxDuringFlight = readOutbox().length
      return Promise.resolve([])
    })
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    expect(outboxDuringFlight).toBe(1)
    expect(readOutbox()).toEqual([])
  })

  it('carries an attemptId, so the server can dedupe a retry', async () => {
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    const [, , batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(batch[0].attemptId).toEqual(expect.any(String))
    expect(batch[0].attemptId).not.toEqual('')
  })

  it('keeps one answer\u2019s id stable across a failed send and its retry', async () => {
    // At-least-once delivery only becomes exactly-once if the id survives the
    // retry. A fresh one per attempt would defeat the server's dedupe.
    const failing = vi.fn().mockRejectedValue(new Error('offline'))
    await recordAttempt(
      { client: clientWith(failing), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    const queuedId = readOutbox()[0].attemptId
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      { factId: 'f2', variantKey: 'answer<prompt>', result: 'got' }
    )
    const [, , batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(batch[0].attemptId).toBe(queuedId)
  })

  it('returns the new ratings on success', async () => {
    const send = vi.fn().mockResolvedValue([rating()])
    const result = await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    expect(result).toEqual([rating()])
    const [setId, game, batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect([setId, game]).toEqual(['s1', 'drill'])
    expect(batch).toMatchObject([attempt])
  })

  it('flushes what the set was holding on the SAME request, oldest first', async () => {
    // One round trip, and the server applies them in order \u2014 so a streak that
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

  it('leaves another set\u2019s held answers alone', async () => {
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

  it('leaves the whole batch queued when the send fails', async () => {
    enqueue(pending({ factId: 'held1' }))
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    expect(result).toBeNull()
    // Nothing is re-queued, because nothing was ever removed. The batch is
    // still exactly where it was written before the send was attempted.
    expect(readOutbox().map(entry => entry.factId)).toEqual(['held1', 'f1'])
  })

  it('keeps an answer graded while a request was in flight', async () => {
    // Clearing by SET rather than by id would take this one with it, unsent.
    let resolveSend: (value: unknown) => void = () => {}
    const send = vi.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          resolveSend = resolve
        })
    )
    const inFlight = recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    enqueue(pending({ factId: 'graded-meanwhile' }))
    resolveSend([])
    await inFlight
    expect(readOutbox().map(entry => entry.factId)).toEqual(['graded-meanwhile'])
  })

  it('never sends more answers than the server will accept', async () => {
    // The server caps a batch at MAX_ATTEMPTS_PER_REQUEST and 400s an
    // oversized one. Since a rejected send now clears nothing, exceeding it
    // would wedge the outbox permanently: every flush from then on fails, and
    // the reader simply stops syncing with nothing to see.
    for (let i = 0; i < MAX_PER_SEND + 20; i++) enqueue(pending({ factId: `held${i}` }))
    const send = vi.fn().mockResolvedValue([])
    await recordAttempt(
      { client: clientWith(send), setId: 's1', game: 'drill', enabled: true },
      attempt
    )
    const [, , batch] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(batch).toHaveLength(MAX_PER_SEND)
    // Oldest first, and the remainder is still held rather than dropped.
    expect(batch[0].factId).toBe('held0')
    expect(readOutbox()).toHaveLength(21)
  })

  it('drains a backlog across successive grades', async () => {
    for (let i = 0; i < MAX_PER_SEND + 5; i++) enqueue(pending({ factId: `held${i}` }))
    const send = vi.fn().mockResolvedValue([])
    const options = { client: clientWith(send), setId: 's1', game: 'drill', enabled: true }
    await recordAttempt(options, attempt)
    expect(readOutbox()).toHaveLength(6)
    await recordAttempt(options, attempt)
    expect(readOutbox()).toHaveLength(0)
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
    const [, game] = send.mock.calls[0] as [string, string, AttemptInput[]]
    expect(game).toBe('board')
  })
})

describe('indexRatings', () => {
  it('keys by the id a game actually holds', () => {
    const index = indexRatings([rating({ factId: 'f9', variantKey: 'when<where>' })])
    expect(index.get('f9:when<where>')?.factId).toBe('f9')
  })
})
