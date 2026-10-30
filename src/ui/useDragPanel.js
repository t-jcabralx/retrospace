'use client'
// A floating panel that can be dragged out of the way: by its grip at once, or by pressing anywhere else on the card and moving
// (buttons, links, fields and lists that scroll keep working: a tap on them is a tap, and a list still scrolls), by pointer or touch;
// the arrow keys on the grip move it too, and Home or a double tap on the grip puts it back. The offset is kept for the tab (sessionStorage) and the panel is always left
// at least KEEP px inside the window (its left edge, where the grip is, never leaves it), so it cannot be lost off screen.
import { useCallback, useEffect, useRef, useState } from 'react'

const KEEP = 56
export const DRAG_SLOP = 6 // a press on the card becomes a drag only after it has moved this far, so a tap stays a tap
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [data-nodrag]'
const STEP = 24
const ZERO = { x: 0, y: 0 }

// -> the offset that moves a panel at `rect` by (dx, dy) without leaving KEEP px of it inside a window of size vw x vh.
export function clampOffset(rect, base, dx, dy, vw, vh) {
  const left = Math.min(Math.max(rect.left + dx, Math.min(0, vw - rect.width)), vw - KEEP) // the grip is at the left edge: that edge stays in the window
  const top = Math.min(Math.max(rect.top + dy, 0), vh - KEEP)
  return { x: Math.round(base.x + (left - rect.left)), y: Math.round(base.y + (top - rect.top)) }
}

// Has a press moved far enough to count as a drag?
export const isDrag = (dx, dy) => Math.hypot(dx, dy) > DRAG_SLOP

const read = (key) => {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(key) ?? 'null')
    return Number.isFinite(v?.x) && Number.isFinite(v?.y) ? v : ZERO
  } catch { return ZERO }
}
const write = (key, v) => { try { globalThis.sessionStorage?.setItem(key, JSON.stringify(v)) } catch { /* private mode: it just will not be remembered */ } }

export function useDragPanel(storageKey) {
  const panel = useRef(null)
  const [pos, setPos] = useState(ZERO)
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)
  const posRef = useRef(ZERO)
  posRef.current = pos

  const move = useCallback((dx, dy) => {
    const el = panel.current
    if (!el) return
    setPos(clampOffset(el.getBoundingClientRect(), posRef.current, dx, dy, window.innerWidth, window.innerHeight))
  }, [])
  // After mount (so the server and the first render agree) take the remembered place.
  useEffect(() => { setPos(read(storageKey)) }, [storageKey])
  // The first time the panel is actually on the page, make sure that place still fits this window: it may have been saved in a
  // different one (a rotated phone, a zoomed page). Some panels only appear later (voting opens), hence a check on every render.
  const fitted = useRef(false)
  const fitFrame = useRef(null)
  useEffect(() => {
    if (fitted.current || !panel.current || !(pos.x || pos.y)) return // nothing remembered yet (or nothing to fit): look again next render
    fitted.current = true
    fitFrame.current = setTimeout(() => move(0, 0), 0) // a timer, not an animation frame: a hidden page gets no frames
  })
  useEffect(() => () => clearTimeout(fitFrame.current), []) // only when the panel goes away: a re-render must not cancel the check
  // The window got smaller: bring the panel back inside it.
  useEffect(() => {
    const fit = () => { if (posRef.current.x || posRef.current.y) move(0, 0) }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [move])

  const begin = (e, moved) => {
    const rect = panel.current?.getBoundingClientRect()
    if (!rect) return
    start.current = { x: e.clientX, y: e.clientY, rect, base: posRef.current, moved }
    if (moved) setDragging(true)
  }
  const capture = (e) => { try { panel.current?.setPointerCapture?.(e.pointerId) } catch { /* the pointer is already gone: the drag simply follows the moves it gets */ } }
  const end = () => { const s = start.current; start.current = null; if (s?.moved) { setDragging(false); write(storageKey, posRef.current) } }

  // The grip starts a drag at once; the rest of the card starts one once the press has moved (see isDrag).
  const grip = {
    onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return
      begin(e, true)
      capture(e)
      e.preventDefault()
    },
    onDoubleClick() { setPos(ZERO); write(storageKey, ZERO) },
    onKeyDown(e) {
      const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key]
      if (d) { e.preventDefault(); move(d[0], d[1]); queueMicrotask(() => write(storageKey, posRef.current)) }
      else if (e.key === 'Home') { e.preventDefault(); setPos(ZERO); write(storageKey, ZERO) }
    },
  }
  const card = {
    onPointerDown(e) {
      if (start.current || (e.button !== undefined && e.button !== 0) || e.target.closest?.(INTERACTIVE)) return
      begin(e, false)
    },
    onPointerMove(e) {
      const s = start.current
      if (!s) return
      if (!s.moved) {
        if (!isDrag(e.clientX - s.x, e.clientY - s.y)) return
        s.moved = true
        setDragging(true)
        capture(e)
      }
      setPos(clampOffset(s.rect, s.base, e.clientX - s.x, e.clientY - s.y, window.innerWidth, window.innerHeight))
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
  const style = pos.x || pos.y ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined
  return { panel, grip, card, style, dragging }
}
