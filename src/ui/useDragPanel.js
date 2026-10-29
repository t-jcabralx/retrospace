'use client'
// A floating panel that can be dragged out of the way by its grip: pointer and touch (pointer capture), or the arrow keys on the
// grip; Home or a double tap on the grip puts it back. The offset is kept for the tab (sessionStorage) and the panel is always left
// at least KEEP px inside the window, so it cannot be lost off screen.
import { useCallback, useEffect, useRef, useState } from 'react'

const KEEP = 56
const STEP = 24
const ZERO = { x: 0, y: 0 }

// -> the offset that moves a panel at `rect` by (dx, dy) without leaving KEEP px of it inside a window of size vw x vh.
export function clampOffset(rect, base, dx, dy, vw, vh) {
  const left = Math.min(Math.max(rect.left + dx, KEEP - rect.width), vw - KEEP)
  const top = Math.min(Math.max(rect.top + dy, 0), vh - KEEP)
  return { x: Math.round(base.x + (left - rect.left)), y: Math.round(base.y + (top - rect.top)) }
}

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

  useEffect(() => { setPos(read(storageKey)) }, [storageKey]) // after mount: the server and the first render agree
  const move = useCallback((dx, dy) => {
    const el = panel.current
    if (!el) return
    setPos(clampOffset(el.getBoundingClientRect(), posRef.current, dx, dy, window.innerWidth, window.innerHeight))
  }, [])
  // The window got smaller: bring the panel back inside it.
  useEffect(() => {
    const fit = () => { if (posRef.current.x || posRef.current.y) move(0, 0) }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [move])

  const grip = {
    onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return
      try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* the pointer is already gone: the drag simply follows the moves it gets */ }
      const rect = panel.current?.getBoundingClientRect()
      if (!rect) return
      start.current = { x: e.clientX, y: e.clientY, rect, base: posRef.current }
      setDragging(true)
      e.preventDefault()
    },
    onPointerMove(e) {
      const s = start.current
      if (!s) return
      setPos(clampOffset(s.rect, s.base, e.clientX - s.x, e.clientY - s.y, window.innerWidth, window.innerHeight))
    },
    onPointerUp() { if (start.current) { start.current = null; setDragging(false); write(storageKey, posRef.current) } },
    onPointerCancel() { if (start.current) { start.current = null; setDragging(false); write(storageKey, posRef.current) } },
    onDoubleClick() { setPos(ZERO); write(storageKey, ZERO) },
    onKeyDown(e) {
      const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key]
      if (d) { e.preventDefault(); move(d[0], d[1]); queueMicrotask(() => write(storageKey, posRef.current)) }
      else if (e.key === 'Home') { e.preventDefault(); setPos(ZERO); write(storageKey, ZERO) }
    },
  }
  const style = pos.x || pos.y ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined
  return { panel, grip, style, dragging }
}
