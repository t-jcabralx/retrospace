'use client'
// The two-ring wheel: participants on the outer ring, prizes on the inner ring, one pointer at the top. Drawn as SVG so it is
// crisp at any size; the rings turn with a CSS rotation set from the timeline, and the slices are memoised so a frame only
// moves two groups. Decorative for assistive technology: the lists beside it carry the same information.
import { memo } from 'react'

const C = 230 // centre of the 460 box
const OUT = [146, 206] // outer ring: inner and outer radius
const IN = [66, 138] // inner ring
const SOFT = ['#cecbf6', '#9fe1cb', '#f5c4b3', '#f4c0d1', '#b5d4f4', '#c0dd97', '#fac775', '#d3d1c7']
const INK = ['#26215c', '#04342c', '#4a1b0c', '#4b1528', '#042c53', '#173404', '#412402', '#2c2c2a']

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
const fit = (s, max) => (Array.from(s).length > max ? `${Array.from(s).slice(0, max - 1).join('')}…` : s)

function labelAt(r, deg, text, { size, fill, weight = 600 }) {
  const [x, y] = pt(r, deg)
  const rot = deg - 90 + (deg > 180 ? 180 : 0) // reads outwards, never upside down
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={weight} fill={fill} transform={`rotate(${rot} ${x} ${y})`}>{text}</text>
}

const People = memo(function People({ list, winnerId }) {
  const n = list.length
  const a = 360 / n
  const size = n <= 8 ? 15 : n <= 16 ? 12.5 : n <= 24 ? 11 : 10
  return list.map((p, i) => {
    const won = winnerId === p.id
    const dim = winnerId && !won
    return (
      <g key={p.id} opacity={dim ? 0.35 : 1}>
        <path d={slice(OUT, i * a, (i + 1) * a)} fill={SOFT[i % SOFT.length]} stroke={won ? 'var(--accent)' : 'var(--panel)'} strokeWidth={won ? 4 : 1.5} />
        {labelAt((OUT[0] + OUT[1]) / 2, (i + 0.5) * a, n > 24 ? initials(p.name) : fit(p.name, n <= 8 ? 14 : 11), { size, fill: INK[i % INK.length] })}
      </g>
    )
  })
})

const Prizes = memo(function Prizes({ list, prizeId }) {
  const n = list.length
  const a = 360 / n
  const size = n <= 5 ? 14 : n <= 10 ? 12 : 10.5
  return list.map((z, i) => {
    const picked = prizeId === z.id
    const dim = prizeId && !picked
    return (
      <g key={z.id} opacity={dim ? 0.4 : 1}>
        <path d={slice(IN, i * a, (i + 1) * a)} fill={z.color} stroke={picked ? '#ffffff' : 'var(--panel)'} strokeWidth={picked ? 4 : 1.5} />
        {labelAt((IN[0] + IN[1]) / 2 + 4, (i + 0.5) * a, `${z.emoji ? `${z.emoji} ` : ''}${fit(z.name, n <= 6 ? 12 : 9)}`, { size, fill: '#ffffff' })}
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

// props: people / prizes = the ring lists, v = the view from timeline.js, hub = what the centre shows
export default function WheelSvg({ people, prizes, v, hub }) {
  const turning = v.turning
  return (
    <svg className="ev-wheel" viewBox="0 0 460 460" role="img" aria-label="Prize wheel: participants on the outer ring, prizes on the inner ring" focusable="false">
      <circle cx={C} cy={C} r={OUT[1] + 6} fill="var(--panel)" stroke="var(--rs-line, var(--line))" strokeWidth="1" />
      <g className="ev-ring" style={{ transform: `rotate(${v.outer}deg)`, opacity: turning === 'prize' ? 0.6 : 1 }}>
        {people.length ? <People list={people} winnerId={v.winnerShown ? v.winner?.id : null} /> : <Empty r={OUT} text="Add people" />}
      </g>
      <g className="ev-ring" style={{ transform: `rotate(${v.inner}deg)`, opacity: turning === 'winner' ? 0.7 : 1 }}>
        {prizes.length ? <Prizes list={prizes} prizeId={v.prizeShown ? v.prize?.id : null} /> : <Empty r={IN} text="Add prizes" />}
      </g>
      <circle cx={C} cy={C} r={IN[0] - 6} fill="var(--panel)" stroke="var(--rs-line, var(--line))" strokeWidth="1.5" />
      <text x={C} y={C} textAnchor="middle" dominantBaseline="central" fontSize={hub.big ? 38 : 14} fontWeight="600" fill="var(--ink)">{hub.text}</text>
      <path className="ev-pointer" d={`M${C} ${C - OUT[1] + 18} L${C - 15} ${C - OUT[1] - 18} L${C + 15} ${C - OUT[1] - 18} Z`} fill="var(--accent)" stroke="var(--panel)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}
