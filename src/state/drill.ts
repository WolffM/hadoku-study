/**
 * The drill loop, as pure state.
 *
 * v1 is a plain pass over a set: walk the cards, flip, self-grade, done. There
 * is no scheduler here — no ease factor, no interval, no due date. A missed
 * card goes to the BACK of this pass's queue and comes round again; the pass
 * ends when the queue empties.
 *
 * Kept free of React so it can be reasoned about (and, later, tested) on its
 * own — the component below it only renders whatever this returns.
 */

import { z } from 'zod'
import type { CardResult, StoredProgress, StudyCard } from '../api/types'

export interface DrillState {
  setId: string
  /** Card ids still to show, in order. A missed card appears again at the back. */
  queue: string[]
  /**
   * FIRST outcome per card, and it never changes afterwards.
   *
   * Recording the first attempt rather than the last is what makes the summary
   * mean something: a card you missed and then got on the retry did not become
   * a card you knew. It also makes the map a stable size — one entry per card
   * — rather than something that rewrites itself as the queue recycles.
   */
  results: Record<string, CardResult>
  updatedAt: number
}

const STORAGE_PREFIX = 'hadoku_study_progress_'

/**
 * Restored state is UNTRUSTED. It may be corrupt, hand-edited, or written by
 * an older version of this bundle, and a bad bookmark must degrade to "start
 * over" rather than crash the drill on someone's phone.
 */
const StoredDrillSchema = z.object({
  setId: z.string(),
  queue: z.array(z.string()),
  results: z.record(z.string(), z.enum(['got', 'missed'])),
  updatedAt: z.number()
})

function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function startDrill(setId: string, cards: StudyCard[], shuffle: boolean): DrillState {
  const ids = cards.map(c => c.id)
  return {
    setId,
    queue: shuffle ? shuffled(ids) : ids,
    results: {},
    updatedAt: Date.now()
  }
}

export function currentCardId(state: DrillState): string | null {
  return state.queue[0] ?? null
}

export function isComplete(state: DrillState): boolean {
  return state.queue.length === 0
}

export function grade(state: DrillState, result: CardResult): DrillState {
  const id = currentCardId(state)
  if (id === null) return state

  const [, ...rest] = state.queue
  return {
    ...state,
    // A missed card goes to the back of the pass, so it comes round again
    // before the pass can end — that IS the drill.
    queue: result === 'missed' ? [...rest, id] : rest,
    results: id in state.results ? state.results : { ...state.results, [id]: result },
    updatedAt: Date.now()
  }
}

export interface DrillSummary {
  got: number
  missed: number
  graded: number
  total: number
  /** Distinct cards still to come. A card queued twice counts once. */
  remaining: number
}

export function summarize(state: DrillState, total: number): DrillSummary {
  const values = Object.values(state.results)
  return {
    got: values.filter(v => v === 'got').length,
    missed: values.filter(v => v === 'missed').length,
    graded: values.length,
    total,
    remaining: new Set(state.queue).size
  }
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Reconcile a restored bookmark against the set as it is NOW.
 *
 * The owner may have edited the set since — cards removed, cards added — and a
 * queue naming ids that no longer exist would show blanks. Anything unknown is
 * dropped from both the queue and the results; cards added since are appended
 * so they are not silently skipped.
 *
 * Returns null when nothing usable survives, which the caller reads as "no
 * bookmark" and starts a fresh pass.
 */
export function reconcile(state: DrillState, cards: StudyCard[]): DrillState | null {
  const live = new Set(cards.map(c => c.id))

  const queue = state.queue.filter(id => live.has(id))
  const results: Record<string, CardResult> = {}
  for (const [id, result] of Object.entries(state.results)) {
    if (live.has(id)) results[id] = result
  }

  const seen = new Set([...queue, ...Object.keys(results)])
  const added = cards.map(c => c.id).filter(id => !seen.has(id))
  const merged = [...queue, ...added]

  if (merged.length === 0 && Object.keys(results).length === 0) return null
  return { ...state, queue: merged, results }
}

function storageKey(setId: string): string {
  return `${STORAGE_PREFIX}${setId}`
}

export function saveLocal(state: DrillState): void {
  try {
    localStorage.setItem(storageKey(state.setId), JSON.stringify(state))
  } catch {
    // Quota, or private-mode Safari. Losing the bookmark is a worse experience,
    // not a broken one — the in-memory pass carries on regardless.
  }
}

export function loadLocal(setId: string): DrillState | null {
  try {
    const raw = localStorage.getItem(storageKey(setId))
    if (!raw) return null
    const parsed = StoredDrillSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.setId !== setId) return null
    return parsed.data
  } catch {
    return null
  }
}

export function clearLocal(setId: string): void {
  try {
    localStorage.removeItem(storageKey(setId))
  } catch {
    // Nothing to do — see saveLocal.
  }
}

export function fromServer(setId: string, progress: StoredProgress): DrillState {
  return {
    setId,
    queue: progress.queue,
    results: progress.results,
    updatedAt: Date.parse(progress.updatedAt)
  }
}

/**
 * Newest wins.
 *
 * The device bookmark and the server bookmark are the same object saved from
 * two places, so "which is newer" is the whole reconciliation — study on the
 * phone, pick up on the laptop, and the laptop's stale local copy loses.
 */
export function newer(a: DrillState | null, b: DrillState | null): DrillState | null {
  if (!a) return b
  if (!b) return a
  return b.updatedAt > a.updatedAt ? b : a
}
