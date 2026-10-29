'use client'
// Pan/zoom state for the canvas element: wheel (scroll pans, ctrl/cmd or pinch zooms), size tracking, sessionStorage.
import { useCallback, useEffect, useRef, useState } from 'react'
import { zoomAt, fitView, centerOn, boundsOf, clampScale } from './geometry.js'

const STEP = 1.25
const keyFor = (code) => `bd:view:${code}`

export function loadView(code) {
  try {
    const v = JSON.parse(sessionStorage.getItem(keyFor(code)))
    if (v && [v.x, v.y, v.scale].every(Number.isFinite)) return { x: v.x, y: v.y, scale: clampScale(v.scale) }
  } catch { /* storage blocked or empty */ }
  return null
}

// Is the wheel over a note whose text can still scroll in that direction?
export function scrollsInside(target, dy) {
  const note = target?.closest?.('.bd-note')
  if (!note || note.scrollHeight <= note.clientHeight + 1) return false
  return dy < 0 ? note.scrollTop > 0 : dy > 0 && note.scrollTop + note.clientHeight < note.scrollHeight - 1
}

export function useViewport(code) {
  const rootRef = useRef(null)
  const [view, setViewState] = useState({ x: 0, y: 0, scale: 1 })
  const viewRef = useRef(view)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const sizeRef = useRef(size)

  const setView = useCallback((next) => {
    const v = typeof next === 'function' ? next(viewRef.current) : next
    viewRef.current = v
    setViewState(v)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const measure = () => {
      const s = { w: el.clientWidth, h: el.clientHeight }
      sizeRef.current = s
      setSize(s)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (e.target.closest?.('textarea')) return
      if (!e.ctrlKey && !e.metaKey && scrollsInside(e.target, e.deltaY)) return // a long note scrolls first; at its end the canvas pans again
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const d = Math.max(-50, Math.min(50, e.deltaY * unit))
        setView((v) => zoomAt(v, { x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.exp(-d * 0.01)))
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false }) // React's onWheel is passive and cannot stop page zoom
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])

  useEffect(() => {
    const t = setTimeout(() => {
      try { sessionStorage.setItem(keyFor(code), JSON.stringify(view)) } catch { /* optional nicety */ }
    }, 300)
    return () => clearTimeout(t)
  }, [code, view])

  const center = () => ({ x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 })
  const api = {
    zoomIn: () => setView((v) => zoomAt(v, center(), STEP)),
    zoomOut: () => setView((v) => zoomAt(v, center(), 1 / STEP)),
    reset: () => setView((v) => zoomAt(v, center(), 1 / v.scale)),
    fit: (items) => {
      const b = boundsOf(items.filter((i) => i.kind !== 'connector'))
      setView(b ? fitView(b, sizeRef.current, Math.min(80, Math.round(Math.min(sizeRef.current.w, sizeRef.current.h) * 0.1))) : centerOn({ x: 0, y: 0, scale: 1 }, sizeRef.current, { x: 0, y: 0 }))
    },
    centerOn: (pt) => setView((v) => centerOn(v, sizeRef.current, pt)),
  }
  return { rootRef, view, viewRef, setView, size, sizeRef, api }
}
