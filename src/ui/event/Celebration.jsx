'use client'
// What plays over the wheel when a winner is revealed: one of a few CSS-only effects, or a GIF the host chose. Decorative:
// nothing here carries information (the result is announced in text), and reduced motion turns every effect off (event.css).
import { useEffect, useState } from 'react'
import { celebrationFor } from '../../lib/wheel.js'

export const EFFECT_INFO = [
  ['confetti', 'Confetti', '🎊'], ['fireworks', 'Fireworks', '🎆'], ['balloons', 'Balloons', '🎈'],
  ['stars', 'Stars', '⭐'], ['sparkles', 'Sparkle rain', '✨'], ['none', 'Nothing', '∅'],
]
const COLORS = ['#f6d65b', '#f08fb0', '#7ccf9a', '#7fb5f2', '#b9a4ff', '#ff9d6c']
const rnd = (i, m) => (i * 2654435761 % 4294967296) % m // a fixed scatter: the same on every screen, no random state

function Fireworks() {
  const bursts = [[22, 28], [74, 24], [50, 46], [30, 68], [72, 62]]
  return bursts.flatMap(([x, y], b) => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2
    const d = 60 + rnd(i + b * 7, 50)
    return <span key={`${b}-${i}`} className="ev-spark" style={{ left: `${x}%`, top: `${y}%`, background: COLORS[(b + i) % COLORS.length], '--x': `${Math.round(Math.cos(a) * d)}px`, '--y': `${Math.round(Math.sin(a) * d)}px`, animationDelay: `${b * 420}ms` }} />
  }))
}
const Balloons = () => Array.from({ length: 11 }, (_, i) => <span key={i} className="ev-balloon" style={{ left: `${4 + (i * 9) % 90}%`, background: COLORS[i % COLORS.length], animationDelay: `${(i % 5) * 260}ms`, animationDuration: `${3200 + rnd(i, 1400)}ms` }} />)
const Falling = ({ glyph, n, cls }) => Array.from({ length: n }, (_, i) => <span key={i} className={cls} style={{ left: `${(i * 100) / n + rnd(i, 4)}%`, animationDelay: `${rnd(i + 3, 1200)}ms`, animationDuration: `${2400 + rnd(i, 1600)}ms`, fontSize: 14 + rnd(i, 14) }}>{glyph}</span>)
const Confetti = () => Array.from({ length: 46 }, (_, i) => <span key={i} className="ev-bit" style={{ left: `${(i * 100) / 46 + rnd(i, 3)}%`, background: COLORS[i % COLORS.length], animationDelay: `${rnd(i, 900)}ms`, animationDuration: `${2200 + rnd(i, 1400)}ms`, width: 7 + rnd(i, 6), height: 10 + rnd(i, 8) }} />)

const PARTS = { confetti: Confetti, fireworks: Fireworks, balloons: Balloons, stars: () => <Falling glyph="★" n={20} cls="ev-glyph ev-glyph--star" />, sparkles: () => <Falling glyph="✨" n={22} cls="ev-glyph" /> }

export function Effect({ effect, seed }) {
  const Parts = PARTS[effect]
  if (!Parts) return null
  return <div className={`ev-fx ev-fx--${effect}`} key={`${effect}-${seed}`} aria-hidden="true"><Parts /></div>
}

// What to play for the current result, and for a preview the host asked for in Setup. -> { effect, gif, dismiss, gifFailed }
export function useCelebration(wheel, v) {
  const [preview, setPreview] = useState(null)
  const [dismissed, setDismissed] = useState(null)
  const [failed, setFailed] = useState(new Set())
  useEffect(() => { if (!preview) return undefined; const t = setTimeout(() => setPreview(null), 5200); return () => clearTimeout(t) }, [preview])
  const seed = wheel.round.spin?.id ?? 0
  const real = v.winnerShown ? { ...celebrationFor(wheel, v.prize), seed } : null
  const active = preview ?? real
  const gif = active?.gif && !failed.has(active.gif) && dismissed !== `${active.seed}` ? active.gif : null
  return {
    effect: active && !gif ? active.effect : null,
    gif, seed: active?.seed ?? 0, winner: preview ? 'Preview' : v.winner?.name,
    play: (c) => setPreview({ ...c, seed: Date.now() }),
    dismiss: () => setDismissed(`${active?.seed}`),
    gifFailed: () => setFailed((s) => new Set(s).add(active?.gif)),
  }
}

// A GIF popping up over the wheel for the winner. Click it (or press Esc) to put it away.
export function GifPop({ cel }) {
  useEffect(() => {
    if (!cel.gif) return undefined
    const onKey = (e) => { if (e.key === 'Escape') cel.dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cel])
  if (!cel.gif) return null
  return (
    <button type="button" className="ev-gifpop" key={`${cel.seed}`} onClick={cel.dismiss} aria-label="Hide the GIF">
      {/* eslint-disable-next-line @next/next/no-img-element -- a host-chosen GIF from any https address, loaded straight from there */}
      <img src={cel.gif} alt="" referrerPolicy="no-referrer" onError={cel.gifFailed} />
      <span className="ev-gifpop-name">{cel.winner}</span>
    </button>
  )
}
