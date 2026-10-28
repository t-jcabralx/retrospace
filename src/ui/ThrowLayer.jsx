'use client'
// Draws thrown emoji over the canvas: it flies in an arc from the bottom centre to the target note (or point), pops with a
// few sparks, shows who threw it for a moment and shakes the note. Both your own throws (layerRef.current.play) and
// other people's (the stream's `throw` messages) come through here. Nothing is stored. With prefers-reduced-motion
// nothing flies or shakes: there is just a pop at the target. Frames come from one requestAnimationFrame loop that runs
// only while something is in the air; at most 12 animations are alive at once and extras are dropped silently.
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import Avatar from './Avatar.jsx'
import { arcPosition, spinAt, impactParticles, createGate, FLIGHT_MS, MAX_FLYING, ANNOUNCE_GAP_MS } from './throwMotion.js'
import { itemLabel } from './labels.js'
import { isSingleEmoji } from '../lib/emoji.js'

const HIT_MS = 1300 // how long the pop and the name chip stay
const SHAKE_MS = 450
const MARGIN = 40

const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// `rootRef`: the canvas element (screen coordinates are relative to it). `viewRef`: the live pan/zoom.
// `byIdRef.current`: Map id -> item, so a note that moved is still hit. `ref`: { play({ emoji, itemId, x, y, name, avatar },
// { announce }) -> id | false, cancel(id) }. Your own throws are played with announce: false (you know you threw it).
export default function ThrowLayer({ ctl, rootRef, viewRef, byIdRef, ref }) {
  const list = useRef([]) // flights, newest last: { id, emoji, name, avatar, itemId, x, y, t0, from, landed, at, sparks }
  const els = useRef(new Map())
  const timers = useRef(new Set())
  const raf = useRef(null)
  const seq = useRef(0)
  const gate = useRef(createGate(ANNOUNCE_GAP_MS))
  const [, render] = useState(0)
  const [said, setSaid] = useState('')
  const refresh = () => render((n) => n + 1)

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
  }

  // Where the flight is headed, in screen pixels: the note's centre if it still exists, else the thrown-at point.
  const target = (f) => {
    const item = f.itemId ? byIdRef.current?.get(f.itemId) : null
    const w = item ? { x: item.x + item.w / 2, y: item.y + item.h / 2 } : { x: f.x, y: f.y }
    const v = viewRef.current
    const root = rootRef.current
    const clamp = (n, max) => Math.min(max + MARGIN, Math.max(-MARGIN, n))
    return { x: clamp(w.x * v.scale + v.x, root.clientWidth), y: clamp(w.y * v.scale + v.y, root.clientHeight) }
  }

  const shake = (itemId) => {
    const el = itemId && rootRef.current?.querySelector(`[data-id="${CSS.escape(itemId)}"]`)
    if (!el) return
    el.classList.remove('is-hit')
    void el.offsetWidth // restart the animation if it is already running
    el.classList.add('is-hit')
    later(() => el.classList.remove('is-hit'), SHAKE_MS)
  }

  const land = (f, calm) => {
    f.landed = true
    f.at = target(f)
    f.sparks = calm ? [] : impactParticles()
    if (!calm) shake(f.itemId)
    later(() => { list.current = list.current.filter((x) => x !== f); refresh() }, HIT_MS)
  }

  const tick = () => {
    raf.current = null
    const now = performance.now()
    let landed = false
    for (const f of list.current) {
      if (f.landed) continue
      const u = (now - f.t0) / FLIGHT_MS
      if (u >= 1) { land(f, false); landed = true; continue }
      const p = arcPosition(f.from, target(f), u)
      const el = els.current.get(f.id)
      if (el) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) rotate(${spinAt(u)}deg) scale(${1 + 0.35 * Math.sin(Math.PI * u)})`
    }
    if (landed) refresh()
    if (list.current.some((f) => !f.landed)) raf.current = requestAnimationFrame(tick)
  }

  const play = (t, { announce = true } = {}) => {
    if (!rootRef.current || !finite(t.x) || !finite(t.y) || !isSingleEmoji(t.emoji)) return false
    const item = t.itemId ? byIdRef.current?.get(t.itemId) : null
    const name = typeof t.name === 'string' && t.name ? t.name.slice(0, 60) : 'Someone'
    if (announce && gate.current()) {
      setSaid((prev) => { const text = `${name} threw ${t.emoji} at ${item ? itemLabel(item) : 'the board'}`; return text === prev ? `${text} ` : text })
    }
    if (document.visibilityState === 'hidden' || list.current.length >= MAX_FLYING) return false // nobody is looking, or too many already
    const root = rootRef.current
    const f = {
      id: ++seq.current, emoji: t.emoji, name, avatar: t.avatar, itemId: t.itemId, x: t.x, y: t.y, landed: false, t0: performance.now(),
      from: { x: root.clientWidth / 2, y: root.clientHeight - 40 },
    }
    list.current = [...list.current, f]
    if (reduced()) land(f, true)
    else if (raf.current === null) raf.current = requestAnimationFrame(tick)
    refresh()
    return f.id
  }
  // The server refused a throw that is still in the air (or just landed): take it back.
  const cancel = (id) => {
    const f = list.current.find((x) => x.id === id)
    if (!f) return
    list.current = list.current.filter((x) => x !== f)
    els.current.delete(id)
    refresh()
  }
  const playRef = useRef(play)
  playRef.current = play
  const cancelRef = useRef(cancel)
  cancelRef.current = cancel
  useImperativeHandle(ref, () => ({ play: (t, o) => playRef.current(t, o), cancel: (id) => cancelRef.current(id) }), [])

  // Other people's throws.
  useEffect(() => ctl.subscribeEphemeral((msg) => {
    if (msg?.t === 'throw') playRef.current({ emoji: msg.emoji, itemId: typeof msg.itemId === 'string' ? msg.itemId : undefined, x: msg.x, y: msg.y, name: msg.name, avatar: msg.avatar })
  }), [ctl.subscribeEphemeral])

  // A hidden tab freezes animation frames: drop what is in the air rather than land it all at once on return.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
      list.current = []
      refresh()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    for (const id of timers.current) clearTimeout(id)
    timers.current.clear()
  }, [])

  return (
    <>
      <div className="bd-throws" aria-hidden="true">
        {list.current.map((f) => (f.landed ? (
          <div key={f.id} className="bd-throw-hit" style={{ left: f.at.x, top: f.at.y }}>
            <span className="bd-throw-pop">{f.emoji}</span>
            {f.sparks.map((s, i) => (
              <i key={i} className="bd-throw-spark" style={{ '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--s': `${s.size}px`, animationDelay: `${s.delay}s` }} />
            ))}
            <span className="bd-throw-chip">
              {f.avatar && <Avatar avatar={f.avatar} name={f.name} size={20} decorative />}
              <span>{f.name}</span>
            </span>
          </div>
        ) : (
          <span
            key={f.id}
            ref={(el) => { if (el) els.current.set(f.id, el); else els.current.delete(f.id) }}
            className="bd-throw-fly"
            style={{ transform: `translate3d(${f.from.x}px, ${f.from.y}px, 0) translate(-50%, -50%)` }}
          >
            {f.emoji}
          </span>
        )))}
      </div>
      <div className="bd-vh" role="status" aria-live="polite">{said}</div>
    </>
  )
}
