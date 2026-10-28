import { AVATAR_PARTS, avatarFromSeed } from '../lib/persona.js'
import './persona.css'

// A creature drawn from five numbers (see AVATAR_PARTS): background, body, eyes, mouth and an extra. Deterministic,
// pure SVG, no images or fonts. Colours are the --pa-* tokens in persona.css; eyes and mouth are always the dark ink
// so the face stays legible on every pastel body. 64 x 64 viewBox.
const INK = 'var(--pa-ink)'
const stroke = { fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }
const EX = [24.5, 39.5] // eye centres
const EY = 35

// `top` is where the head ends, so hats, ears and antennae sit on it whatever the shape.
const BODIES = [
  { top: 18, shape: (p) => <circle cx="32" cy="37" r="19" {...p} /> },
  { top: 15, shape: (p) => <ellipse cx="32" cy="36" rx="16" ry="21" {...p} /> },
  { top: 23, shape: (p) => <ellipse cx="32" cy="39" rx="22" ry="16" {...p} /> },
  { top: 17, shape: (p) => <rect x="13" y="17" width="38" height="38" rx="13" {...p} /> },
  { top: 13, shape: (p) => <path d="M32 13C42 25 52 32 52 42a20 20 0 0 1-40 0C12 32 22 25 32 13Z" {...p} /> },
  { top: 20, shape: (p) => <rect x="14" y="20" width="36" height="34" rx="17" {...p} /> },
  { top: 16, shape: (p) => <path d="M32 16C39 16 55 45 54 50 53 56 11 56 10 50 9 45 25 16 32 16Z" {...p} /> },
  { top: 18, cloud: true },
]
const CLOUD = [[22, 39, 12], [42, 39, 12], [32, 31, 14]]

const eye = (kind, x, side) => {
  switch (kind) {
    case 0: return <circle cx={x} cy={EY} r="2.7" fill={INK} />
    case 1: return <g><circle cx={x} cy={EY} r="3.7" fill={INK} /><circle cx={x - 1.2} cy={EY - 1.3} r="1.2" fill="#fff" /></g>
    case 2: return <path d={`M${x - 3.6} ${EY + 1.2}Q${x} ${EY - 4.6} ${x + 3.6} ${EY + 1.2}`} {...stroke} />
    case 3: return <path d={`M${x - 3.6} ${EY}H${x + 3.6}`} {...stroke} />
    case 4: return <g><ellipse cx={x} cy={EY} rx="4.4" ry="5.2" fill="#fff" stroke={INK} strokeWidth="1.7" /><circle cx={x + (side ? -1 : 1)} cy={EY + 0.6} r="2.1" fill={INK} /></g>
    case 5: return side
      ? <circle cx={x} cy={EY} r="2.7" fill={INK} />
      : <path d={`M${x - 3.6} ${EY + 1.2}Q${x} ${EY - 4.6} ${x + 3.6} ${EY + 1.2}`} {...stroke} />
    case 6: return <circle cx={x} cy={EY} r="3.6" fill="#fff" stroke={INK} strokeWidth="1.9" />
    default: return <path d={`M${x} ${EY - 4.6}L${x + 1.3} ${EY - 1.3}L${x + 4.6} ${EY}L${x + 1.3} ${EY + 1.3}L${x} ${EY + 4.6}L${x - 1.3} ${EY + 1.3}L${x - 4.6} ${EY}L${x - 1.3} ${EY - 1.3}Z`} fill={INK} />
  }
}

const MOUTHS = [
  <path key="0" d="M25 42Q32 50 39 42" {...stroke} />,
  <g key="1"><path d="M24 41Q32 53 40 41Z" fill={INK} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" /><path d="M28.5 47.5Q32 45 35.5 47.5Q32 50.5 28.5 47.5Z" fill="var(--pa-tongue)" /></g>,
  <ellipse key="2" cx="32" cy="45" rx="2.7" ry="3.3" fill={INK} />,
  <path key="3" d="M27 45H37" {...stroke} />,
  <path key="4" d="M25 43Q28.5 48.5 32 43Q35.5 48.5 39 43" {...stroke} />,
  <g key="5"><path d="M30 46.5V49.5a2 2 0 0 0 4 0V46.5Z" fill="var(--pa-tongue)" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" /><path d="M25 42Q32 50 39 42" {...stroke} /></g>,
  <path key="6" d="M26 45.5Q34 47.5 40 41.5" {...stroke} />,
  <path key="7" d="M25 41H39Q39 52 32 52 25 52 25 41Z" fill={INK} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />,
]

// Parts drawn behind the head (ears) and in front of it, by `extra`.
const behind = (extra, top, bodyIx) => (extra === 4 ? (
  <g fill={`var(--pa-body-${bodyIx})`} stroke={INK} strokeWidth="2.2">
    <circle cx="19" cy={top + 4} r="6.5" /><circle cx="45" cy={top + 4} r="6.5" />
  </g>
) : null)

const front = (extra, top) => {
  switch (extra) {
    case 1: return (
      <g {...stroke} strokeWidth="2">
        <circle cx={EX[0]} cy={EY} r="6.6" /><circle cx={EX[1]} cy={EY} r="6.6" /><path d={`M${EX[0] + 6.6} ${EY}H${EX[1] - 6.6}`} />
      </g>
    )
    case 2: return (
      <g strokeLinejoin="round" stroke={INK} strokeWidth="2">
        <path d={`M23.5 ${top + 3}L32 ${top - 11}L40.5 ${top + 3}Q32 ${top + 6} 23.5 ${top + 3}Z`} fill="var(--pa-hat)" />
        <circle cx="32" cy={top - 11} r="2.6" fill="#fff" />
      </g>
    )
    case 3: return (
      <g stroke={INK} strokeWidth="2.2" strokeLinecap="round">
        <path d={`M32 ${top + 2}V${top - 8}`} fill="none" /><circle cx="32" cy={top - 10} r="3" fill="var(--pa-hat)" />
      </g>
    )
    case 5: return (
      <g stroke={INK} strokeWidth="2" strokeLinejoin="round" fill="var(--pa-hat)">
        <path d={`M42 ${top + 8}L52 ${top + 2}V${top + 15}Z`} /><path d={`M42 ${top + 8}L33 ${top + 2}V${top + 15}Z`} /><circle cx="42" cy={top + 8} r="3" />
      </g>
    )
    case 6: return <g fill="var(--pa-cheek)" opacity=".75"><ellipse cx="17.5" cy="42" rx="4.4" ry="3" /><ellipse cx="46.5" cy="42" rx="4.4" ry="3" /></g>
    case 7: return (
      <g fill={INK} opacity=".55">
        {[[19, 40], [22.5, 42.2], [26, 40.4], [38, 40.4], [41.5, 42.2], [45, 40]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />)}
      </g>
    )
    default: return null
  }
}

const clampPart = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0)

export const EXTRA_NAMES = ['none', 'glasses', 'party hat', 'antenna', 'ears', 'bow', 'rosy cheeks', 'freckles']

// avatar: { bg, body, eyes, mouth, extra }. A missing or damaged avatar falls back to one derived from the name, so
// a face always renders. Pass `decorative` when the name is printed right next to it.
export default function Avatar({ avatar, name = '', size = 40, decorative = false }) {
  const ok = avatar && Object.keys(AVATAR_PARTS).every((k) => Number.isInteger(avatar[k]))
  const a = ok ? avatar : avatarFromSeed(name)
  const bg = clampPart(a.bg, AVATAR_PARTS.bg)
  const bodyIx = clampPart(a.body, AVATAR_PARTS.body)
  const body = BODIES[bodyIx]
  const eyes = clampPart(a.eyes, AVATAR_PARTS.eyes)
  const mouth = clampPart(a.mouth, AVATAR_PARTS.mouth)
  const extra = clampPart(a.extra, AVATAR_PARTS.extra)
  const fill = { fill: `var(--pa-body-${bodyIx})`, stroke: INK, strokeWidth: 2.4, strokeLinejoin: 'round' }
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name ? `Avatar of ${name}` : 'Avatar' }

  return (
    <svg className="pa-avatar" viewBox="0 0 64 64" width={size} height={size} focusable="false" {...a11y}>
      <circle cx="32" cy="32" r="32" style={{ fill: `color-mix(in srgb, var(--pa-bg-${bg}) var(--pa-bg-mix), var(--panel))` }} />
      {behind(extra, body.top, bodyIx)}
      {body.cloud ? (
        <g>
          <g fill={INK} stroke={INK} strokeWidth="4.8" strokeLinejoin="round">{CLOUD.map(([x, y, r]) => <circle key={x + y} cx={x} cy={y} r={r} />)}<rect x="22" y="40" width="20" height="11" /></g>
          <g fill={`var(--pa-body-${bodyIx})`}>{CLOUD.map(([x, y, r]) => <circle key={x + y} cx={x} cy={y} r={r} />)}<rect x="22" y="40" width="20" height="10.4" /></g>
        </g>
      ) : body.shape(fill)}
      {eye(eyes, EX[0], 0)}
      {eye(eyes, EX[1], 1)}
      {MOUTHS[mouth]}
      {front(extra, body.top)}
    </svg>
  )
}
