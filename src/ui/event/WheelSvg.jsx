'use client'
// The two-ring wheel: participants on the outer ring, prizes on the inner ring, one pointer at the top. Drawn as SVG so it is
// crisp at any size; the rings turn with a CSS rotation set from the timeline, and the slices are memoised so a frame only
// moves two groups. Decorative for assistive technology: the lists beside it carry the same information.
import { memo, useEffect, useRef, useState } from 'react'
import { sliceAtPointer } from './timeline.js'

const C = 230 // centre of the 460 box
const OUT = [146, 206] // outer ring: inner and outer radius
const IN = [66, 138] // inner ring
const SOFT = ['#cecbf6', '#9fe1cb', '#f5c4b3', '#f4c0d1', '#b5d4f4', '#c0dd97', '#fac775', '#d3d1c7']
const INK = ['#26215c', '#04342c', '#4a1b0c', '#4b1528', '#042c53', '#173404', '#412402', '#2c2c2a']

// Neighbouring slices never share a colour, including the last one meeting the first.
const shade = (i, n, len) => (i === n - 1 && n % len === 1 ? (i + 3) % len : i % len)
const BULBS = Array.from({ length: 32 }, (_, i) => i)
const pt = (r, deg) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)]
function slice([r1, r2], a0, a1) {
  if (a1 - a0 >= 359.99) return `M${C} ${C - r2} A${r2} ${r2} 0 1 1 ${C - 0.01} ${C - r2} L${C - 0.01} ${C - r1} A${r1} ${r1} 0 1 0 ${C} ${C - r1} Z`
  const big = a1 - a0 > 180 ? 1 : 0
  const [x1, y1] = pt(r2, a0)
  const [x2, y2] = pt(r2, a1)
  const [x3, y3] = pt(r1, a1)
  const [x4, y4] = pt(r1, a0)
  return `M${x1} ${y1} A${r2} ${r2} 0 ${big} 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 ${big} 0 ${x4} ${y4} Z`
}
const initials = (name) => Array.from(name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? '').join('').toUpperCase()).join('')
// Text that follows the curve of a slice, so it reads left to right: along the top it sits above its baseline, along the bottom
// the baseline runs the other way. `turned` = how far the ring has turned while resting, so what is at the bottom OF THE SCREEN
// is the half that gets flipped. The size shrinks to the arc that is available, then the text is cut with an ellipsis.
function arcLabel(id, r, a0, a1, str, { base, fill, weight = 600, turned = 0 }) {
  const mid = (a0 + a1) / 2
  const eff = (mid + turned) % 360
  const bottom = eff > 90 && eff < 270
  const chars = Array.from(str)
  const arc = r * (((a1 - a0) * Math.PI) / 180) * 0.84 - 6
  const size = Math.max(9, Math.min(base, arc / (0.58 * Math.max(1, chars.length))))
  const room = Math.max(3, Math.floor(arc / (0.58 * size)))
  const text = chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : str
  const rr = bottom ? r + size * 0.34 : r - size * 0.34
  const [x0, y0] = pt(rr, bottom ? a1 : a0)
  const [x1, y1] = pt(rr, bottom ? a0 : a1)
  const d = `M${x0} ${y0} A${rr} ${rr} 0 ${a1 - a0 > 180 ? 1 : 0} ${bottom ? 0 : 1} ${x1} ${y1}`
  return (
    <>
      <path id={id} d={d} fill="none" />
      <text fontSize={Math.round(size * 10) / 10} fontWeight={weight} fill={fill}><textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{text}</textPath></text>
    </>
  )
}

const People = memo(function People({ list, winnerId, turned }) {
  const n = list.length
  const a = 360 / n
  const base = n <= 6 ? 18 : n <= 10 ? 16 : n <= 16 ? 14 : n <= 24 ? 12 : 10
  return list.map((p, i) => {
    const won = winnerId === p.id
    const dim = winnerId && !won
    const fill = INK[shade(i, n, INK.length)]
    return (
      <g key={p.id} opacity={dim ? 0.35 : 1}>
        <path className={won ? 'ev-winslice' : undefined} d={slice(OUT, i * a, (i + 1) * a)} fill={SOFT[shade(i, n, SOFT.length)]} stroke={won ? 'var(--accent)' : 'var(--panel)'} strokeWidth={won ? 4 : 1.5} />
        {arcLabel(`ev-p${i}`, (OUT[0] + OUT[1]) / 2, i * a, (i + 1) * a, n > 24 ? initials(p.name) : p.name, { base, fill, turned })}
      </g>
    )
  })
})

const Prizes = memo(function Prizes({ list, prizeId, turned }) {
  const n = list.length
  const a = 360 / n
  const base = n <= 4 ? 17 : n <= 8 ? 15 : n <= 12 ? 13 : 11
  return list.map((z, i) => {
    const picked = prizeId === z.id
    const dim = prizeId && !picked
    return (
      <g key={z.id} opacity={dim ? 0.4 : 1}>
        <path className={picked ? 'ev-winslice' : undefined} d={slice(IN, i * a, (i + 1) * a)} fill={z.color} stroke={picked ? '#ffffff' : 'var(--panel)'} strokeWidth={picked ? 4 : 1.5} />
        {arcLabel(`ev-z${i}`, (IN[0] + IN[1]) / 2 + 2, i * a, (i + 1) * a, `${z.emoji ? `${z.emoji} ` : ''}${z.name}${z.qty > 1 ? ` ×${z.qty}` : ''}`, { base, fill: '#ffffff', turned })}
      </g>
    )
  })
})

// An empty ring: a plain soft band with a short invitation, upright at the bottom.
const Empty = ({ r, text }) => (
  <g>
    <circle cx={C} cy={C} r={(r[0] + r[1]) / 2} fill="none" stroke="var(--ink)" strokeWidth={r[1] - r[0]} opacity="0.07" />
    <text x={C} y={C + (r[0] + r[1]) / 2} textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="600" fill="var(--muted)">{text}</text>
  </g>
)

// props: people / prizes = the ring lists, v = the view from timeline.js, hub = { text } for the centre,
//        spin = { text, off } when the centre can start the next spin (host only), onSpin, onTick (a slice passed the pointer)
export default function WheelSvg({ people, prizes, v, hub, spin, onSpin, onTick }) {
  const turning = v.turning
  const ring = turning === 'prize' ? v.inner : v.outer
  const count = turning === 'prize' ? prizes.length : people.length
  const slot = turning ? sliceAtPointer(ring, count) : -1
  const last = useRef(-1)
  const [flick, setFlick] = useState(0)
  useEffect(() => { // a slice crossed the pointer: flick it and tick
    if (slot !== -1 && last.current !== -1 && slot !== last.current) { setFlick((f) => f + 1); onTick?.() }
    last.current = slot
  }, [slot, onTick])
  const canSpin = Boolean(spin && !spin.off)
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (canSpin) onSpin() } }
  return (
    <svg className={`ev-wheel${turning ? ' is-turning' : ''}${v.winnerShown ? ' is-win' : ''}`} viewBox="0 0 460 460" role="group" aria-label={`Prize wheel with ${people.length} ${people.length === 1 ? 'person' : 'people'} on the outer ring and ${prizes.length} ${prizes.length === 1 ? 'prize' : 'prizes'} on the inner ring`} focusable="false">
      <circle cx={C} cy={C} r={OUT[1] + 7} fill="var(--panel)" stroke="var(--rs-line, var(--line))" strokeWidth="1" />
      {BULBS.map((i) => { const [x, y] = pt(OUT[1] + 7, (i * 360) / BULBS.length); return <circle key={i} className="ev-bulb" cx={x} cy={y} r="3.2" style={{ animationDelay: `${(i % 2) * 220}ms` }} /> })}
      <g className="ev-ring" style={{ transform: `rotate(${v.outer}deg)`, opacity: turning === 'prize' ? 0.6 : 1 }}>
        {people.length ? <People list={people} winnerId={v.winnerShown ? v.winner?.id : null} turned={turning ? 0 : v.outer} /> : <Empty r={OUT} text="Add people" />}
      </g>
      <g className="ev-ring" style={{ transform: `rotate(${v.inner}deg)`, opacity: turning === 'winner' ? 0.7 : 1 }}>
        {prizes.length ? <Prizes list={prizes} prizeId={v.prizeShown ? v.prize?.id : null} turned={turning ? 0 : v.inner} /> : <Empty r={IN} text="Add prizes" />}
      </g>
      <circle cx={C} cy={C} r={IN[0] - 4} fill="var(--panel)" stroke="var(--rs-line, var(--line))" strokeWidth="1.5" />
      {spin ? (
        <g className={`ev-hub${canSpin ? ' is-ready' : ''}`} role="button" tabIndex={canSpin ? 0 : -1} aria-label={canSpin ? spin.text : `${spin.text} (not available yet)`} aria-disabled={!canSpin} onClick={() => canSpin && onSpin()} onKeyDown={onKey}>
          <circle cx={C} cy={C} r={IN[0] - 14} fill={canSpin ? 'var(--accent)' : 'var(--line)'} />
          <text x={C} y={C - 6} textAnchor="middle" dominantBaseline="central" fontSize="26" aria-hidden="true">{hub.text}</text>
          <text x={C} y={C + 20} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" letterSpacing="1.5" fill={canSpin ? 'var(--rs-on-accent, #fff)' : 'var(--muted)'}>SPIN</text>
        </g>
      ) : (
        <text x={C} y={C} textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="600" fill="var(--ink)" aria-hidden="true">{hub.text}</text>
      )}
      <path key={flick} className="ev-pointer" d={`M${C} ${C - OUT[1] + 18} L${C - 15} ${C - OUT[1] - 20} L${C + 15} ${C - OUT[1] - 20} Z`} fill="var(--accent)" stroke="var(--panel)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}
