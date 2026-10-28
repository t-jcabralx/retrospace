import Avatar from '../Avatar.jsx'
import { HeartIcon } from '../site/icons.jsx'

// A drawn mock of a live retro board (CSS and SVG, not a screenshot): sticky notes in the six note colours, two
// collaborators' cursors with the real anonymous-avatar component, a vote badge and a confetti burst. Decorative:
// the whole thing is hidden from assistive technology and its text is never needed to use the page.
const OTTER = { bg: 3, body: 6, eyes: 1, mouth: 0, extra: 0 }
const KOALA = { bg: 0, body: 3, eyes: 4, mouth: 1, extra: 2 }
const LYNX = { bg: 5, body: 1, eyes: 2, mouth: 4, extra: 5 }

const COLUMNS = [
  { title: 'Went well', notes: [
    { text: 'Pairing sessions really helped', color: 'yellow', rot: '-1.6deg', delay: '0s', votes: 5 },
    { text: 'A calm release week', color: 'green', rot: '1.2deg', delay: '-2.2s' },
  ] },
  { title: 'To improve', notes: [
    { text: 'Too many status meetings', color: 'pink', rot: '1.4deg', delay: '-1.1s' },
    { text: 'Handoffs between teams', color: 'blue', rot: '-1.1deg', delay: '-3.4s' },
  ] },
  { title: 'Ideas', notes: [
    { text: 'Try async standups', color: 'purple', rot: '-1.3deg', delay: '-0.6s' },
    { text: 'Rotate the facilitator', color: 'orange', rot: '1.5deg', delay: '-2.8s' },
  ] },
]

const CONFETTI_COLORS = ['#ff6b8b', '#ffc533', '#3ccf91', '#4dabf7', '#9775fa', '#ff922b']
// Pieces on a few rings around the burst centre, so the picture is the same on every render.
const CONFETTI = Array.from({ length: 22 }, (_, i) => {
  const ring = i % 3
  const angle = (i * 137.5 * Math.PI) / 180
  const dist = 16 + ring * 15 + (i % 4) * 3
  return { x: Math.round(Math.cos(angle) * dist), y: Math.round(Math.sin(angle) * dist), rot: (i * 53) % 180, shape: i % 3, color: CONFETTI_COLORS[i % 6], s: 5 + (i % 3) * 1.5 }
})

function Cursor({ avatar, name, className, color }) {
  return (
    <div className={`ls-pv-cursor ${className}`} style={{ '--cur': color }}>
      <svg width="22" height="22" viewBox="0 0 22 22" focusable="false">
        <path d="M3 2l6.8 16 2.6-6.6L19 8.8z" fill="var(--cur)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="ls-pv-label"><Avatar avatar={avatar} name={name} size={20} decorative />{name}</span>
    </div>
  )
}

export default function BoardPreview() {
  return (
    <div className="ls-preview" aria-hidden="true">
      <div className="ls-pv-bar">
        <span className="ls-pv-title">Team retro</span>
        <span className="ls-pv-live"><i />Live</span>
        <span className="ls-pv-people">
          <Avatar avatar={OTTER} name="Brave Otter" size={26} decorative />
          <Avatar avatar={KOALA} name="Sunny Koala" size={26} decorative />
          <Avatar avatar={LYNX} name="Mellow Lynx" size={26} decorative />
        </span>
      </div>
      <div className="ls-pv-canvas">
        <div className="ls-pv-cols">
          {COLUMNS.map((col) => (
            <div className="ls-pv-col" key={col.title}>
              <p className="ls-pv-colhead">{col.title}</p>
              {col.notes.map((n) => (
                <div className="ls-pv-note" key={n.text} style={{ '--note': `var(--note-${n.color})`, rotate: n.rot, animationDelay: n.delay }}>
                  {n.text}
                  {n.votes && <span className="ls-pv-vote"><HeartIcon width={11} height={11} />{n.votes}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <Cursor avatar={OTTER} name="Brave Otter" className="ls-pv-cursor-a" color="var(--accent)" />
        <Cursor avatar={KOALA} name="Sunny Koala" className="ls-pv-cursor-b" color="#e0568a" />
        <svg className="ls-pv-confetti" viewBox="-60 -60 120 120" focusable="false">
          <g>
            {CONFETTI.map((c, i) => (
              <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`} fill={c.color}>
                {c.shape === 0 && <rect x={-c.s / 2} y={-c.s / 3} width={c.s} height={(c.s * 2) / 3} rx="1" />}
                {c.shape === 1 && <circle r={c.s / 2.2} />}
                {c.shape === 2 && <path d={`M0 ${-c.s / 1.6}L${c.s / 1.6} ${c.s / 2}H${-c.s / 1.6}Z`} />}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}
