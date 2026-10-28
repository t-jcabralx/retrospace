'use client'
// The canvas pointer state machine: pan, pinch, marquee, draw-to-size, item move and resize, connector linking.
// Handlers read their inputs from a ref refreshed every render, so they never act on stale selection/items.
//
// Dragging never touches the board state: the moving items are held in `overlay` (id -> partial rect) and
// streamed to peers as untracked updates (<= 20/s). Only the drop is committed, as one tracked step.
import { useRef, useState } from 'react'
import { screenToWorld, itemsInRect, itemsFullyInside, resizeRect, clampScale } from './geometry.js'
import { patchOps, movableIds, gestureEnd } from './ops.js'

const DRAG_PX = 3
const LIVE_MS = 50
const MIN_DRAW = 24

const normalize = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
const hold = (e, el) => { try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ } }

// env: { ctl, rootRef, viewRef, setView, tool, spaceDown, selection, setSelection, actions, setTool }
export function useGestures(env) {
  const E = useRef(env)
  E.current = env
  const g = useRef(null)
  const touches = useRef(new Map())
  const [overlay, setOverlay] = useState(null)
  const [marquee, setMarquee] = useState(null)
  const [draft, setDraft] = useState(null)
  const [panning, setPanning] = useState(false)
  const [linkFrom, setLink] = useState(null)
  const linkRef = useRef(null) // read by handlers, which are created once
  const setLinkFrom = (v) => { linkRef.current = v; setLink(v) }
  const api = useRef(null)

  if (!api.current) {
    const local = (e) => {
      const r = E.current.rootRef.current.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const world = (e) => screenToWorld(local(e), E.current.viewRef.current)
    const boxes = () => E.current.ctl.items.filter((i) => i.kind !== 'connector')
    const clear = () => { setOverlay(null); setMarquee(null); setDraft(null); setPanning(false) }

    const stream = (gs, patches) => {
      const now = performance.now()
      if (now - gs.lastLive < LIVE_MS) return
      gs.lastLive = now
      gs.streamed = true
      E.current.ctl.live(patchOps(patches))
    }

    // A drag/resize that ends without a commit (Esc, pointercancel, a second finger, net-zero drop) must undo what
    // it streamed. Returns true when `gs` was a move/resize it handled.
    const settleDrag = (gs, cancelled) => {
      if (!gs || (gs.type !== 'move' && gs.type !== 'resize')) return false
      const { ctl } = E.current
      const { revert, commit } = gestureEnd({ streamed: gs.streamed, cancelled, original: gs.orig, next: gs.nextMap })
      if (revert.length) ctl.revert(revert)
      if (commit) ctl.commit(commit.restore, commit.final)
      return true
    }

    // Two fingers: whatever else was going on is abandoned and the pair pans and zooms the view.
    const startPinch = () => {
      settleDrag(g.current, true)
      clear()
      const [a, b] = [...touches.current.values()]
      g.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...E.current.viewRef.current } }
    }

    const startPan = (e, tap = false) => {
      hold(e, E.current.rootRef.current)
      g.current = { type: 'pan', pointerId: e.pointerId, s0: local(e), v0: { ...E.current.viewRef.current }, moved: false, tap }
      setPanning(true)
    }

    const startMove = (e, id) => {
      const { ctl, selection, setSelection } = E.current
      const sel = selection.has(id) ? selection : new Set([id])
      if (sel !== selection) setSelection(sel)
      const ids = movableIds(ctl.items, sel, (i) => ctl.canEdit(i))
      const byId = new Map(ctl.items.map((i) => [i.id, i]))
      g.current = {
        type: 'move', pointerId: e.pointerId, start: world(e), screen: local(e), moved: false, lastLive: 0, streamed: false, nextMap: null,
        orig: new Map(ids.map((id) => [id, { x: byId.get(id).x, y: byId.get(id).y }])),
        narrowTo: sel.size > 1 && !e.shiftKey ? id : null,
      }
    }

    const finish = (e, cancelled) => {
      const gs = g.current
      if (e.pointerType === 'touch') touches.current.delete(e.pointerId)
      if (!gs) return
      if (gs.type === 'pinch') {
        if (touches.current.size < 2) { g.current = null; clear() }
        return
      }
      if (gs.pointerId !== e.pointerId) return
      const { setSelection } = E.current
      g.current = null
      if (settleDrag(gs, cancelled) && !cancelled && gs.type === 'move' && !gs.moved && gs.narrowTo) {
        setSelection(new Set([gs.narrowTo]))
      }
      if (gs.type === 'pan' && gs.tap && !gs.moved) setSelection(new Set())
      if (gs.type === 'place' && !cancelled) E.current.actions.createAt(gs.kind, gs.start)
      if (gs.type === 'draw' && !cancelled) {
        const r = gs.rect
        if (r && r.w >= MIN_DRAW && r.h >= MIN_DRAW) E.current.actions.createRect(gs.kind, r)
        else E.current.actions.createAt(gs.kind, gs.start)
      }
      clear()
    }

    api.current = {
      // Runs first (capture phase) for every pointer so two touches become a pinch before any item sees them.
      onDownCapture(e) {
        if (e.pointerType !== 'touch') return
        touches.current.set(e.pointerId, local(e))
        if (touches.current.size === 2) startPinch()
      },

      onCanvasDown(e) {
        if (touches.current.size > 1) return
        const { tool, spaceDown, selection, setSelection, actions } = E.current
        if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); startPan(e); return }
        if (e.button !== 0) return
        const w = world(e)
        if (e.pointerType === 'touch' && tool === 'select') { startPan(e, true); return }
        if (tool === 'select') {
          hold(e, E.current.rootRef.current)
          if (!e.shiftKey) setSelection(new Set())
          g.current = { type: 'marquee', pointerId: e.pointerId, start: w, base: e.shiftKey ? new Set(selection) : new Set() }
        } else if (tool === 'note' || tool === 'text') {
          // Placed on release: the editor opens focused, and a press's own focus change would otherwise take it back.
          e.preventDefault()
          g.current = { type: 'place', pointerId: e.pointerId, kind: tool, start: w }
        } else if (tool === 'shape' || tool === 'frame') {
          hold(e, E.current.rootRef.current)
          g.current = { type: 'draw', pointerId: e.pointerId, kind: tool, start: w, rect: null }
        } else if (tool === 'connector') {
          setLinkFrom(null)
        }
      },

      onItemDown(e, id) {
        if (touches.current.size > 1) return
        const { tool, spaceDown, selection, setSelection, ctl } = E.current
        if (e.button === 1 || (e.button === 0 && spaceDown)) return // bubbles to the canvas, which pans
        if (tool !== 'select' && tool !== 'connector') return // creation tools place a new item even over an old one
        e.stopPropagation()
        if (e.button !== 0) return
        if (tool === 'connector') {
          if (ctl.readOnly) return
          const from = linkRef.current
          if (!from) setLinkFrom(id)
          else if (from === id) setLinkFrom(null)
          else { E.current.actions.createConnector(from, id); setLinkFrom(null) }
          return
        }
        if (e.shiftKey) {
          const next = new Set(selection)
          if (!next.delete(id)) next.add(id)
          setSelection(next)
          return
        }
        startMove(e, id)
      },

      onConnectorDown(e, id) {
        if (touches.current.size > 1 || E.current.tool !== 'select' || e.button !== 0) return
        e.stopPropagation()
        const { selection, setSelection } = E.current
        if (e.shiftKey) {
          const next = new Set(selection)
          if (!next.delete(id)) next.add(id)
          setSelection(next)
        } else setSelection(new Set([id]))
      },

      onResizeStart(e, id, handle) {
        const item = E.current.ctl.items.find((i) => i.id === id)
        if (!item || touches.current.size > 1 || e.button !== 0) return
        e.stopPropagation()
        hold(e, E.current.rootRef.current)
        g.current = {
          type: 'resize', pointerId: e.pointerId, id: item.id, handle, kind: item.kind, start: world(e), lastLive: 0, streamed: false, nextMap: null,
          rect: { x: item.x, y: item.y, w: item.w, h: item.h },
          orig: new Map([[item.id, { x: item.x, y: item.y, w: item.w, h: item.h }]]),
        }
      },

      onMove(e) {
        if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, local(e))
        const gs = g.current
        if (!gs) return
        if (gs.type === 'pinch') {
          if (touches.current.size < 2) return
          const [a, b] = [...touches.current.values()]
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const scale = clampScale(gs.v0.scale * (Math.hypot(a.x - b.x, a.y - b.y) / gs.d0))
          const w0 = screenToWorld(gs.mid0, gs.v0)
          E.current.setView({ scale, x: mid.x - w0.x * scale, y: mid.y - w0.y * scale })
          return
        }
        if (gs.pointerId !== e.pointerId) return
        const s = local(e)
        switch (gs.type) {
          case 'pan': {
            const dx = s.x - gs.s0.x, dy = s.y - gs.s0.y
            if (!gs.moved && Math.hypot(dx, dy) < DRAG_PX) return
            gs.moved = true
            E.current.setView({ ...gs.v0, x: gs.v0.x + dx, y: gs.v0.y + dy })
            break
          }
          case 'marquee': {
            const rect = normalize(gs.start, world(e))
            setMarquee(rect)
            const hit = new Set(gs.base)
            for (const i of itemsInRect(boxes().filter((b) => b.kind !== 'frame'), rect)) hit.add(i.id)
            // A frame needs to be wholly enclosed, otherwise any marquee drawn inside one would grab it.
            for (const f of itemsFullyInside({ ...rect, id: '' }, boxes().filter((b) => b.kind === 'frame'))) hit.add(f.id)
            E.current.setSelection(hit)
            break
          }
          case 'draw': {
            gs.rect = normalize(gs.start, world(e))
            setDraft(gs.rect)
            break
          }
          case 'move': {
            if (!gs.moved) {
              if (Math.hypot(s.x - gs.screen.x, s.y - gs.screen.y) < DRAG_PX) return
              gs.moved = true
              if (gs.orig.size) hold(e, E.current.rootRef.current)
            }
            if (!gs.orig.size) return
            const w = world(e)
            const dx = Math.round(w.x - gs.start.x)
            const dy = Math.round(w.y - gs.start.y)
            const next = new Map([...gs.orig].map(([id, o]) => [id, { x: o.x + dx, y: o.y + dy }]))
            gs.nextMap = next
            setOverlay(next)
            stream(gs, next)
            break
          }
          case 'resize': {
            const w = world(e)
            const r = resizeRect(gs.rect, gs.handle, w.x - gs.start.x, w.y - gs.start.y, {
              min: gs.kind === 'frame' ? 60 : 24,
              keepAspect: gs.kind === 'image' || e.shiftKey,
            })
            const next = new Map([[gs.id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }]])
            gs.nextMap = next
            setOverlay(next)
            stream(gs, next)
            break
          }
          default:
        }
      },

      onUp: (e) => finish(e, false),
      onCancel: (e) => finish(e, true),
      // Abandons whatever gesture is in progress (Escape).
      reset() { settleDrag(g.current, true); g.current = null; clear(); setLinkFrom(null) },
    }
  }

  return {
    handlers: api.current,
    overlay, marquee, draft, panning, linkFrom, setLinkFrom,
    cancel: () => api.current.reset(),
  }
}
