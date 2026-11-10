import { describe, expect, it } from 'vitest'
import { POOL, type Wisdom } from './pool'
import { TRADITIONS, REGIONS, traditionById } from './traditions'
import { litTraditions, pickElsewhere, pickFrom } from './pick'
import { INNER, OUTER, labelSpot, place, regionLabelBoxes, starLabelBox } from './layout'

const w = (id: string, tradition: string): Wisdom => ({ id, tradition, text: id, source: id })

/** Cycles through fixed draws so every branch of a pick is reachable. */
const seq = (...draws: number[]) => {
  let i = 0
  return () => draws[i++ % draws.length]
}

describe('the pool', () => {
  it('names only traditions on the map', () => {
    for (const entry of POOL) expect(traditionById(entry.tradition), entry.id).toBeDefined()
  })

  it('has unique ids, because shared links carry them', () => {
    expect(new Set(POOL.map(e => e.id)).size).toBe(POOL.length)
  })

  it('bridges only to entries that exist, and never to itself', () => {
    const ids = new Set(POOL.map(e => e.id))
    for (const entry of POOL) {
      for (const b of entry.bridges ?? []) {
        expect(ids.has(b), `${entry.id} → ${b}`).toBe(true)
        expect(b).not.toBe(entry.id)
      }
    }
  })

  it('carries no stray whitespace a reader would see', () => {
    for (const entry of POOL) expect(entry.text).toBe(entry.text.trim())
  })
})

describe('the roster', () => {
  it('has unique ids', () => {
    expect(new Set(TRADITIONS.map(t => t.id)).size).toBe(TRADITIONS.length)
  })

  it('puts every region on the wheel at least once', () => {
    for (const r of REGIONS)
      expect(
        TRADITIONS.some(t => t.region === r.id),
        r.id
      ).toBe(true)
  })
})

describe('pickElsewhere', () => {
  const pool = [w('a1', 'a'), w('a2', 'a'), w('b1', 'b')]

  it('leaves the current tradition whenever another is lit', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(pickElsewhere(pool, pool[0], () => r)?.tradition).toBe('b')
    }
  })

  it('falls back to another passage of the same tradition when it is the only one lit', () => {
    const solo = [w('a1', 'a'), w('a2', 'a')]
    expect(pickElsewhere(solo, solo[0], seq(0))?.id).toBe('a2')
  })

  it('returns the one passage there is, rather than nothing', () => {
    const one = [w('a1', 'a')]
    expect(pickElsewhere(one, one[0])?.id).toBe('a1')
  })

  it('picks anything on first load, and nothing from an empty pool', () => {
    expect(pickElsewhere(pool, null, () => 0.99)?.id).toBe('b1')
    expect(pickElsewhere([], null)).toBeUndefined()
  })
})

describe('pickFrom', () => {
  const pool = [w('a1', 'a'), w('a2', 'a'), w('b1', 'b')]

  it('stays in the tradition asked for and avoids a repeat', () => {
    expect(pickFrom(pool, 'a', pool[0], () => 0)?.id).toBe('a2')
  })

  it('repeats only when the tradition has one passage', () => {
    expect(pickFrom(pool, 'b', pool[2])?.id).toBe('b1')
  })

  it('is undefined for an unlit tradition', () => {
    expect(pickFrom(pool, 'zzz', null)).toBeUndefined()
  })
})

describe('litTraditions', () => {
  it('lists each tradition with a passage once', () => {
    expect([...litTraditions([w('a1', 'a'), w('a2', 'a'), w('b1', 'b')])].sort()).toEqual([
      'a',
      'b'
    ])
  })
})

describe('the map', () => {
  const placed = place(TRADITIONS)

  it('places every tradition exactly once', () => {
    expect(placed.map(p => p.tradition.id).sort()).toEqual(TRADITIONS.map(t => t.id).sort())
  })

  it('keeps every star inside the rings', () => {
    for (const p of placed) {
      expect(p.radius).toBeGreaterThanOrEqual(INNER)
      expect(p.radius).toBeLessThanOrEqual(OUTER)
    }
  })

  it('puts older traditions nearer the centre', () => {
    const by = (id: string) => placed.find(p => p.tradition.id === id)!.radius
    expect(by('maat')).toBeLessThan(by('ubuntu'))
  })

  it('never stacks two stars where a tap cannot tell them apart', () => {
    // A star is drawn ~3 units across with a ~7 unit tap target; 6 apart keeps
    // targets from swallowing each other on a phone.
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const d = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y)
        expect(d, `${placed[i].tradition.id} ↔ ${placed[j].tradition.id}`).toBeGreaterThan(6)
      }
    }
  })

  it('keeps every star name off every region name', () => {
    // Any star can be labelled (hover, focus, a tap on an unlit one), so this
    // holds for all of them, not only the lit ones.
    const regions = regionLabelBoxes()
    for (const p of placed) {
      const box = starLabelBox(labelSpot(p, regions), p.tradition.name)
      for (const r of regions) {
        const hit = box.x0 < r.x1 && r.x0 < box.x1 && box.y0 < r.y1 && r.y0 < box.y1
        expect(hit, p.tradition.id).toBe(false)
      }
    }
  })
})
