import { useMemo, useState, type KeyboardEvent } from 'react'
import { REGIONS, TRADITIONS, type Tradition } from './traditions'
import {
  INNER,
  OUTER,
  REGION_LABEL_RADIUS,
  labelSpot,
  place,
  polar,
  radiusFor,
  sectorMid,
  sectorStart
} from './layout'

/** Rings drawn behind the stars, so "nearer the centre is older" can be read off the map. */
const RINGS: readonly { year: number; label: string }[] = [
  { year: -2000, label: '2000 BCE' },
  { year: -1000, label: '1000 BCE' },
  { year: 0, label: '1 CE' },
  { year: 1000, label: '1000' },
  { year: 2000, label: '2000' }
]

const SUN_RAYS = 12

interface Props {
  lit: ReadonlySet<string>
  /** The tradition whose passage is on screen. */
  active: string | null
  /** An unlit star the reader tapped. */
  peeking: string | null
  onPickTradition: (t: Tradition) => void
  onPickElsewhere: () => void
}

/** Enter and Space activate, as they would on a <button>. */
function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

export function WisdomMap({ lit, active, peeking, onPickTradition, onPickElsewhere }: Props) {
  const placed = useMemo(() => place(TRADITIONS).map(p => ({ ...p, label: labelSpot(p) })), [])
  const [hover, setHover] = useState<string | null>(null)
  const activeStar = placed.find(p => p.tradition.id === active)

  return (
    <svg
      className="wisdom-map"
      viewBox="-118 -100 236 200"
      role="group"
      aria-label="Map of the world's ethical traditions"
    >
      <defs>
        <radialGradient id="wisdom-glow">
          <stop offset="0%" className="wisdom-map__glow-core" />
          <stop offset="100%" className="wisdom-map__glow-edge" />
        </radialGradient>
      </defs>

      <circle className="wisdom-map__halo" r={OUTER + 4} />

      {RINGS.map(ring => (
        <g key={ring.year}>
          <circle className="wisdom-map__ring" r={radiusFor(ring.year)} />
          {/* Down the 180° sector border, which no star sits on. */}
          <text
            className="wisdom-map__ring-label"
            x={0}
            y={radiusFor(ring.year) + 0.6}
            dominantBaseline="hanging"
          >
            {ring.label}
          </text>
        </g>
      ))}

      {REGIONS.map(region => {
        const edgeIn = polar(sectorStart(region.id), INNER - 6)
        const edgeOut = polar(sectorStart(region.id), OUTER + 4)
        const label = polar(sectorMid(region.id), REGION_LABEL_RADIUS)
        return (
          <g key={region.id}>
            <line
              className="wisdom-map__border"
              x1={edgeIn.x}
              y1={edgeIn.y}
              x2={edgeOut.x}
              y2={edgeOut.y}
            />
            <text
              className="wisdom-map__region"
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {region.label}
            </text>
          </g>
        )
      })}

      {activeStar && (
        // Keyed by tradition so the beam re-draws itself each time it moves.
        <line
          key={activeStar.tradition.id}
          className="wisdom-map__beam"
          x1={0}
          y1={0}
          x2={activeStar.x}
          y2={activeStar.y}
          pathLength={1}
        />
      )}

      {placed.map(({ tradition, x, y, label }) => {
        const isLit = lit.has(tradition.id)
        const isActive = tradition.id === active
        const showLabel = isLit || isActive || hover === tradition.id || peeking === tradition.id
        const pick = () => onPickTradition(tradition)
        return (
          <g
            key={tradition.id}
            className="wisdom-map__star"
            data-lit={isLit ? 'true' : 'false'}
            data-active={isActive ? 'true' : 'false'}
            role="button"
            tabIndex={0}
            aria-label={`${tradition.name} — ${isLit ? 'show a passage' : 'not yet studied'}`}
            aria-pressed={isActive}
            onClick={pick}
            onKeyDown={onActivate(pick)}
            onPointerEnter={() => setHover(tradition.id)}
            onPointerLeave={() => setHover(h => (h === tradition.id ? null : h))}
            onFocus={() => setHover(tradition.id)}
            onBlur={() => setHover(h => (h === tradition.id ? null : h))}
          >
            <title>{`${tradition.name}: ${tradition.blurb}`}</title>
            {/* Invisible, larger hit area: a 3-unit dot is a ~5px target on a phone. */}
            <circle className="wisdom-map__hit" cx={x} cy={y} r={4.2} />
            {isLit && <circle className="wisdom-map__aura" cx={x} cy={y} r={4.5} />}
            <circle className="wisdom-map__dot" cx={x} cy={y} r={isLit ? 2.1 : 1.3} />
            {showLabel && (
              <text
                className="wisdom-map__label"
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                dominantBaseline="middle"
              >
                {tradition.name}
              </text>
            )}
          </g>
        )
      })}

      <g
        className="wisdom-map__sun"
        role="button"
        tabIndex={0}
        aria-label="Show wisdom from another tradition"
        onClick={onPickElsewhere}
        onKeyDown={onActivate(onPickElsewhere)}
      >
        <title>Show wisdom from another tradition</title>
        <circle className="wisdom-map__sun-glow" r={INNER - 8} fill="url(#wisdom-glow)" />
        {Array.from({ length: SUN_RAYS }, (_, i) => {
          const a = (360 / SUN_RAYS) * i
          const from = polar(a, 11)
          const to = polar(a, i % 2 === 0 ? 17 : 14.5)
          return (
            <line key={a} className="wisdom-map__ray" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          )
        })}
        <circle className="wisdom-map__sun-core" r={8} />
      </g>
    </svg>
  )
}
