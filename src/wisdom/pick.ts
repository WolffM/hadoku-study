/**
 * Choosing what to show next.
 *
 * Pure, with the random source injected, so the "always somewhere new" promise
 * is a tested property rather than a hope.
 */

import type { Wisdom } from './pool'

export type Rng = () => number

function choose<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

/** The traditions that have at least one chosen passage — the lit stars. */
export function litTraditions(pool: readonly Wisdom[]): Set<string> {
  return new Set(pool.map(w => w.tradition))
}

/**
 * A passage from anywhere, preferring a DIFFERENT tradition from the one on
 * screen — the centre of the map is "take me somewhere else". Falls back to a
 * different passage from the same tradition, then to the same passage, so it
 * always returns something while the pool has anything at all.
 */
export function pickElsewhere(
  pool: readonly Wisdom[],
  current: Wisdom | null,
  rng: Rng = Math.random
): Wisdom | undefined {
  if (current === null) return choose(pool, rng)

  const traditions = [...litTraditions(pool)].filter(t => t !== current.tradition)
  const tradition = choose(traditions, rng)
  if (tradition !== undefined)
    return choose(
      pool.filter(w => w.tradition === tradition),
      rng
    )

  return (
    choose(
      pool.filter(w => w.id !== current.id),
      rng
    ) ?? current
  )
}

/**
 * A passage from one tradition — a click on its star. Avoids repeating the
 * passage on screen when the tradition has another to offer. Undefined for an
 * unlit tradition.
 */
export function pickFrom(
  pool: readonly Wisdom[],
  tradition: string,
  current: Wisdom | null,
  rng: Rng = Math.random
): Wisdom | undefined {
  const own = pool.filter(w => w.tradition === tradition)
  const fresh = own.filter(w => w.id !== current?.id)
  return choose(fresh.length > 0 ? fresh : own, rng)
}
