/**
 * Where each tradition sits on the map.
 *
 * The map is a wheel of radius ~100 centred on the origin (the SVG box is
 * wider than tall so the side region labels are not clipped on a phone). ANGLE is region —
 * six equal sectors, clockwise from the top, in REGIONS order. RADIUS is age:
 * the oldest traditions sit nearest the light at the centre and the youngest
 * at the rim, so the wheel reads like the rings of a tree.
 *
 * Within a sector, traditions are spread evenly by age order, so two that
 * began in the same century (Stoicism and Epicureanism) never share a point.
 */

import { REGIONS, type Region, type Tradition } from './traditions'

export const OLDEST = -2500
export const NEWEST = 2000
export const INNER = 34
export const OUTER = 88
const SECTOR = 360 / REGIONS.length
/** Degrees kept clear at each sector edge, so neighbours across a border do not touch. */
const GUTTER = 9

export interface Placed {
  tradition: Tradition
  x: number
  y: number
  /** Degrees clockwise from the top. */
  angle: number
  radius: number
}

export function radiusFor(year: number): number {
  const clamped = Math.min(NEWEST, Math.max(OLDEST, year))
  return INNER + ((clamped - OLDEST) / (NEWEST - OLDEST)) * (OUTER - INNER)
}

/** Degrees clockwise from the top → SVG coordinates (y grows downward). */
export function polar(angle: number, radius: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) }
}

export function sectorStart(region: Region): number {
  return REGIONS.findIndex(r => r.id === region) * SECTOR
}

export function sectorMid(region: Region): number {
  return sectorStart(region) + SECTOR / 2
}

export function place(traditions: readonly Tradition[]): Placed[] {
  const placed: Placed[] = []
  for (const region of REGIONS) {
    const members = traditions.filter(t => t.region === region.id).sort((a, b) => a.year - b.year)
    const start = sectorStart(region.id) + GUTTER
    const span = SECTOR - 2 * GUTTER
    members.forEach((tradition, i) => {
      const angle =
        members.length === 1 ? start + span / 2 : start + (span * i) / (members.length - 1)
      const radius = radiusFor(tradition.year)
      placed.push({ tradition, angle, radius, ...polar(angle, radius) })
    })
  }
  return placed
}

/*
 * Labels.
 *
 * SVG cannot measure text before it is drawn, so widths are estimated from the
 * character count. That is coarse, but it only has to be good enough to keep
 * a star's name off a region's name, and the test below holds it to that.
 */

export const STAR_LABEL_SIZE = 4
export const REGION_LABEL_SIZE = 5
export const REGION_LABEL_RADIUS = OUTER + 8
/** Average glyph width per unit of font size; region names are uppercase and letter-spaced. */
const STAR_GLYPH = 0.56
const REGION_GLYPH = 0.74

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

export type Anchor = 'start' | 'middle' | 'end'

export interface LabelSpot {
  x: number
  y: number
  anchor: Anchor
}

function boxOf(spot: LabelSpot, width: number, size: number): Box {
  const x0 =
    spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - width : spot.x - width / 2
  return { x0, x1: x0 + width, y0: spot.y - size / 2, y1: spot.y + size / 2 }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

export function regionLabelBoxes(): Box[] {
  return REGIONS.map(region => {
    const at = polar(sectorMid(region.id), REGION_LABEL_RADIUS)
    const width = region.label.length * REGION_LABEL_SIZE * REGION_GLYPH
    return boxOf({ ...at, anchor: 'middle' }, width, REGION_LABEL_SIZE)
  })
}

export function starLabelBox(spot: LabelSpot, name: string): Box {
  return boxOf(spot, name.length * STAR_LABEL_SIZE * STAR_GLYPH, STAR_LABEL_SIZE)
}

/**
 * Where a star's name goes. Outward from the centre line first, so names do not
 * run across the light; then inward, then above, then below — the first spot
 * that keeps clear of every region name.
 */
export function labelSpot(p: Placed, regions: readonly Box[] = regionLabelBoxes()): LabelSpot {
  const gap = 3.6
  const out: Anchor = p.x >= 0 ? 'start' : 'end'
  const inward: Anchor = out === 'start' ? 'end' : 'start'
  const side = (anchor: Anchor): LabelSpot => ({
    x: p.x + (anchor === 'start' ? gap : -gap),
    y: p.y + 0.4,
    anchor
  })
  const above: LabelSpot = { x: p.x, y: p.y - 4.4, anchor: 'middle' }
  const below: LabelSpot = { x: p.x, y: p.y + 5.4, anchor: 'middle' }

  const nearAxis = Math.abs(p.x) <= 4
  const candidates = nearAxis
    ? [p.y < 0 ? above : below, p.y < 0 ? below : above, side(out), side(inward)]
    : [side(out), side(inward), above, below]

  const clear = candidates.find(c => {
    const box = starLabelBox(c, p.tradition.name)
    return regions.every(r => !overlaps(box, r))
  })
  return clear ?? candidates[0]
}
