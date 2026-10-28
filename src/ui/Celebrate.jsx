'use client'
// The Celebrate button (top bar, everyone who can write) and the listener that plays other people's celebrations.
// The button fires the chosen effect here and tells the room with { t: 'celebrate', effect }; it waits 3 seconds
// before it can be used again, like the server. A small menu next to it picks confetti, balloons or fireworks.
import { useEffect, useId, useRef, useState } from 'react'
import { useEffects, EFFECT_EMOJI } from './Effects.jsx'
import './collab.css'

const COOLDOWN_MS = 3000
const RECEIVE_GAP_MS = 2000 // a sender cannot flood this screen, whatever the server lets through
const CHOICES = [
  { id: 'confetti', label: 'Confetti' },
  { id: 'balloons', label: 'Balloons' },
  { id: 'fireworks', label: 'Fireworks' },
]

export default function Celebrate({ ctl }) {
  const fx = useEffects()
  const [effect, setEffect] = useState('confetti')
  const [cooling, setCooling] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef(null)
  const root = useRef(null)
  const toggle = useRef(null)
  const items = useRef([])
  const menuId = useId()

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  useEffect(() => { if (open) items.current[Math.max(0, CHOICES.findIndex((c) => c.id === effect))]?.focus() }, [open, effect])

  const go = (id) => {
    if (cooling) return
    setEffect(id)
    setOpen(false)
    fx.fire(id, { announce: 'You celebrated' })
    ctl.sendEphemeral({ t: 'celebrate', effect: id })
    setCooling(true)
    timer.current = setTimeout(() => setCooling(false), COOLDOWN_MS)
  }

  const moveFocus = (e) => {
    const i = items.current.indexOf(document.activeElement)
    const to = { ArrowDown: (i + 1) % CHOICES.length, ArrowUp: (i + CHOICES.length - 1) % CHOICES.length, Home: 0, End: CHOICES.length - 1 }[e.key]
    if (to === undefined) return false
    e.preventDefault()
    items.current[to]?.focus()
    return true
  }

  return (
    <div
      ref={root}
      className="bd-celebrate"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); toggle.current?.focus() }
        else if (open) moveFocus(e)
      }}
      onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget)) setOpen(false) }}
    >
      <button
        type="button"
        className={`bd-celebrate-main${cooling ? ' is-cooling' : ''}`}
        aria-disabled={cooling ? 'true' : undefined}
        aria-label={`Celebrate with ${effect}`}
        title={cooling ? 'Just a moment…' : `Celebrate with ${effect}`}
        onClick={() => go(effect)}
      >
        <span aria-hidden="true">{EFFECT_EMOJI[effect]}</span><span className="bd-celebrate-label">Celebrate</span>
      </button>
      <button
        ref={toggle}
        type="button"
        className="bd-celebrate-more"
        aria-label="Choose a celebration"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div id={menuId} className="bd-celebrate-menu" role="menu" aria-label="Celebrations">
          {CHOICES.map((c, i) => (
            <button
              key={c.id}
              ref={(el) => { items.current[i] = el }}
              type="button"
              role="menuitemradio"
              aria-checked={c.id === effect}
              aria-disabled={cooling ? 'true' : undefined}
              tabIndex={-1}
              className="bd-celebrate-item"
              onClick={() => go(c.id)}
            >
              <span aria-hidden="true">{EFFECT_EMOJI[c.id]}</span>{c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Headless: plays celebrations that arrive on the stream. Rendered for every viewer, read-only ones included.
export function CelebrationListener({ ctl, presence }) {
  const fx = useEffects()
  const latest = useRef({ ctl, presence, fx })
  latest.current = { ctl, presence, fx }

  useEffect(() => {
    const lastFrom = new Map()
    return ctl.subscribeEphemeral((msg, from) => {
      if (msg?.t !== 'celebrate' || !CHOICES.some((c) => c.id === msg.effect)) return
      const at = Date.now()
      if (at - (lastFrom.get(from) ?? 0) < RECEIVE_GAP_MS) return
      lastFrom.set(from, at)
      if (lastFrom.size > 500) lastFrom.delete(lastFrom.keys().next().value)
      const { ctl: c, presence: p, fx: f } = latest.current
      const name = p?.nameOf(from) ?? c.state?.participants?.find((x) => x.uid === from)?.name ?? 'Someone'
      f.fire(msg.effect, { announce: `${name} celebrated` })
    })
  }, [ctl.subscribeEphemeral])

  return null
}
