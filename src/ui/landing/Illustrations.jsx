// Original line-and-colour illustrations for the landing page. Drawn with the site's own colours (accent, panel, ink), so
// they follow light and dark. Decorative: hidden from assistive tech, the text beside them says the same thing.
const NOTE = { yellow: '#f6d65b', pink: '#f08fb0', green: '#7ccf9a', blue: '#7fb5f2' }

const Frame = ({ children, label }) => (
  <svg className="ls-ill" viewBox="0 0 240 160" role="img" aria-label={label} focusable="false">
    <rect x="1" y="1" width="238" height="158" rx="14" fill="var(--rs-accent-soft)" stroke="var(--rs-line)" />
    {children}
  </svg>
)

// 1. A board with sticky notes and a plus button.
export function CreateIllustration() {
  return (
    <Frame label="A board with sticky notes and a plus button">
      <rect x="26" y="26" width="188" height="108" rx="10" fill="var(--panel)" stroke="var(--rs-line)" />
      <g className="ls-float">
        <rect x="42" y="42" width="48" height="40" rx="4" fill={NOTE.yellow} /><path d="M50 54h30M50 62h20" stroke="#8a6d00" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="ls-float ls-float--b">
        <rect x="100" y="48" width="48" height="40" rx="4" fill={NOTE.pink} transform="rotate(-4 124 68)" /><path d="M108 60h30M108 68h16" stroke="#8b2f52" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="ls-float ls-float--c">
        <rect x="158" y="42" width="40" height="40" rx="4" fill={NOTE.green} transform="rotate(3 178 62)" /><path d="M166 54h24M166 62h14" stroke="#1f6b3f" strokeWidth="2" strokeLinecap="round" />
      </g>
      <rect x="42" y="96" width="80" height="26" rx="6" fill={NOTE.blue} opacity="0.55" />
      <circle cx="176" cy="110" r="17" fill="var(--accent)" /><path d="M176 102v16M168 110h16" stroke="var(--rs-on-accent)" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  )
}

// 2. A six-character code travelling from a laptop to a phone.
export function ShareIllustration() {
  return (
    <Frame label="A six-character code sent from a laptop to a phone">
      <rect x="22" y="40" width="94" height="64" rx="7" fill="var(--panel)" stroke="var(--rs-line)" /><rect x="14" y="104" width="110" height="9" rx="4.5" fill="var(--rs-line)" />
      <rect x="34" y="58" width="70" height="28" rx="6" fill="var(--rs-accent-soft)" stroke="var(--accent)" />
      <text x="69" y="77" textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="14" fontWeight="700" letterSpacing="2" fill="var(--ink)">K7M2QX</text>
      <path className="ls-dash" d="M124 74h40" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 8" />
      <path d="M160 66l10 8-10 8" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="176" y="34" width="40" height="76" rx="8" fill="var(--panel)" stroke="var(--rs-line)" strokeWidth="1.5" /><rect x="190" y="38" width="12" height="3" rx="1.5" fill="var(--rs-line)" />
      <rect x="182" y="50" width="28" height="12" rx="4" fill="var(--rs-accent-soft)" stroke="var(--accent)" /><text x="196" y="59" textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="6.5" fontWeight="700" fill="var(--ink)">K7M2QX</text>
      <rect x="182" y="70" width="28" height="10" rx="5" fill="var(--accent)" />
      <circle cx="196" cy="94" r="6" fill={NOTE.pink} /><circle cx="196" cy="94" r="6" fill="none" stroke="var(--rs-line)" />
    </Frame>
  )
}

// 3. Avatars with cursors, adding notes together.
export function CollabIllustration() {
  return (
    <Frame label="Several people adding notes to the same board">
      <rect x="22" y="24" width="196" height="112" rx="10" fill="var(--panel)" stroke="var(--rs-line)" />
      <rect x="38" y="42" width="52" height="38" rx="4" fill={NOTE.yellow} /><path d="M46 54h32M46 62h20" stroke="#8a6d00" strokeWidth="2" strokeLinecap="round" />
      <g className="ls-float"><rect x="104" y="40" width="52" height="38" rx="4" fill={NOTE.green} /><path d="M112 52h32M112 60h18" stroke="#1f6b3f" strokeWidth="2" strokeLinecap="round" /></g>
      <g className="ls-float ls-float--b"><rect x="164" y="64" width="44" height="36" rx="4" fill={NOTE.blue} /><path d="M172 76h28M172 84h14" stroke="#1d4f8c" strokeWidth="2" strokeLinecap="round" /></g>
      <g className="ls-float ls-float--c"><circle cx="56" cy="104" r="11" fill={NOTE.pink} /><circle cx="52" cy="102" r="1.6" fill="#5a1a33" /><circle cx="60" cy="102" r="1.6" fill="#5a1a33" /><path d="M51 108q5 4 10 0" stroke="#5a1a33" strokeWidth="1.5" fill="none" strokeLinecap="round" /></g>
      <g className="ls-float"><circle cx="112" cy="110" r="11" fill={NOTE.yellow} /><circle cx="108" cy="108" r="1.6" fill="#6b5400" /><circle cx="116" cy="108" r="1.6" fill="#6b5400" /><path d="M107 114q5 4 10 0" stroke="#6b5400" strokeWidth="1.5" fill="none" strokeLinecap="round" /></g>
      <path d="M150 96l-3 17 5-4 4 8 3-2-4-8 7-1z" fill="var(--accent)" stroke="var(--panel)" strokeWidth="1" />
      <path d="M126 34l-2 11 3-2 3 5 2-1-3-5 4-1z" fill={NOTE.green} stroke="var(--panel)" strokeWidth="1" />
    </Frame>
  )
}

// A few drifting shapes behind the hero text.
export function HeroConfetti() {
  // [left, top (as a percentage of the hero), colour, size in px, animation step]
  const bits = [
    [8, 14, NOTE.yellow, 14, 0], [22, 72, NOTE.pink, 10, 1], [46, 8, NOTE.green, 12, 2], [58, 84, NOTE.blue, 16, 0],
    [78, 18, NOTE.pink, 12, 1], [90, 66, NOTE.yellow, 10, 2], [34, 40, NOTE.blue, 8, 1],
  ]
  return (
    <div className="ls-confetti" aria-hidden="true">
      {bits.map(([left, top, color, size, delay], i) => (
        <span key={i} style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, background: color, animationDelay: `${delay * 0.9}s`, borderRadius: i % 2 ? 99 : 3 }} />
      ))}
    </div>
  )
}

// A two-ring prize wheel, turning slowly (outer ring one way, inner ring the other). Decorative.
const SOFT = ['#cecbf6', '#9fe1cb', '#f5c4b3', '#f4c0d1', '#b5d4f4', '#c0dd97', '#fac775', '#d3d1c7']
const GIFTS = [['#7f77dd', '🎁'], ['#1d9e75', '☕'], ['#d85a30', '🎧'], ['#d4537e', '🏖️'], ['#378add', '⌨️'], ['#639922', '🍕']]
const W = 120
const at = (r, deg) => [W + r * Math.sin((deg * Math.PI) / 180), W - r * Math.cos((deg * Math.PI) / 180)]
const wedge = (r1, r2, a0, a1) => { const [x1, y1] = at(r2, a0); const [x2, y2] = at(r2, a1); const [x3, y3] = at(r1, a1); const [x4, y4] = at(r1, a0); return `M${x1} ${y1} A${r2} ${r2} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 0 0 ${x4} ${y4}Z` }

export function WheelArt() {
  return (
    <svg className="ls-wheelart" viewBox="0 0 240 250" role="img" aria-label="A prize wheel with people on the outer ring and prizes on the inner ring" focusable="false">
      <circle cx={W} cy={W + 8} r="114" fill="var(--panel)" stroke="var(--rs-line)" />
      <g transform="translate(0 8)">
        <g className="ls-wheelart-outer">
          {SOFT.map((c, i) => <path key={c} d={wedge(76, 108, i * 45, (i + 1) * 45)} fill={c} stroke="var(--panel)" strokeWidth="1.2" />)}
          {SOFT.map((c, i) => { const [x, y] = at(92, i * 45 + 22.5); return <circle key={`d${c}`} cx={x} cy={y} r="3.2" fill="#2c2c2a" opacity="0.45" /> })}
        </g>
        <g className="ls-wheelart-inner">
          {GIFTS.map(([c, e], i) => <path key={c} d={wedge(34, 72, i * 60, (i + 1) * 60)} fill={c} stroke="var(--panel)" strokeWidth="1.2" />)}
          {GIFTS.map(([c, e], i) => { const [x, y] = at(54, i * 60 + 30); return <text key={`t${c}`} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="15">{e}</text> })}
        </g>
        <circle cx={W} cy={W} r="26" fill="var(--accent)" />
        <text x={W} y={W} textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill="var(--rs-on-accent)" letterSpacing="1">SPIN</text>
      </g>
      <path d={`M${W} 26 L${W - 11} 3 L${W + 11} 3Z`} fill="var(--accent)" stroke="var(--panel)" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  )
}
