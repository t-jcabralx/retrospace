'use client'
// Things the user does to items (create, delete, duplicate, nudge, restyle…) expressed as ops on the board.
import { useRef } from 'react'
import { boundsOf, screenToWorld } from './geometry.js'
import { addOp, deleteOps, duplicateOps, reorderOps, movableIds, nextZ, topZ, patchOps, DEFAULTS } from './ops.js'
import { addsAnonymously } from '../lib/anon.js'
import { fileToImage, ImageTooLarge } from './images.js'

const TEXT_KINDS = ['note', 'text', 'shape', 'frame', 'card'] // Enter edits these (a card's message); new ones of the creatable kinds open their editor straight away
const MAX_IMAGE_SIDE = 360 // on-canvas size of a freshly placed image

// env: { ctl, canCreate(kind), tool, selection, setSelection, setTool, setEditing, viewRef, sizeRef, style, setStyle }; read at call time.
export function useActions(env) {
  const E = useRef(env)
  E.current = env
  const api = useRef(null)

  if (!api.current) {
    const items = () => E.current.ctl.items
    const byId = (id) => items().find((i) => i.id === id)
    const selected = () => [...E.current.selection].map(byId).filter(Boolean)
    const editable = (list) => list.filter((i) => E.current.ctl.canEdit(i))

    const add = (op, { edit = false } = {}) => {
      const { ctl, setSelection, setTool, setEditing } = E.current
      if (!ctl.local([op])) return null
      setSelection(new Set([op.id]))
      setTool('select')
      if (edit) setEditing(op.id)
      return op.id
    }

    // When the focused item/connector is being deleted, focus would fall to <body>: hand it to the next item in
    // paint order (else the previous one, else the canvas region) without selecting it, so a held Delete key
    // cannot eat the whole board.
    const keepFocus = (gone) => {
      const active = document.activeElement
      const id = active?.dataset?.id
      const region = active?.closest?.('[role="region"]')
      if (!id || !gone.has(id) || !region) return
      const all = [...region.querySelectorAll('.bd-item[data-id], .bd-connector[data-id]')]
      const at = all.indexOf(active)
      const keep = (el) => !gone.has(el.dataset.id)
      const next = all.slice(at + 1).find(keep) ?? all.slice(0, at).reverse().find(keep) ?? region
      if (next !== region) next.dataset.noSelect = '1'
      next.focus({ preventScroll: true })
    }

    const center = () => {
      const { viewRef, sizeRef } = E.current
      return screenToWorld({ x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 }, viewRef.current)
    }

    api.current = {
      // Creates `kind` centred on a world point, or filling `rect`.
      createAt(kind, pt) {
        const d = DEFAULTS[kind]
        return api.current.createRect(kind, { x: pt.x - d.w / 2, y: pt.y - d.h / 2, w: d.w, h: d.h })
      },
      createRect(kind, rect) {
        const { style } = E.current
        const data = DEFAULTS[kind].data(kind === 'shape' ? { color: style.shape, shape: style.shapeKind } : { color: style.note })
        const op = addOp(kind, rect, data, nextZ(items(), kind))
        if (addsAnonymously(E.current.ctl.board?.anonymousNotes, style.anon, kind)) op.item.anon = true // the server decides what the board's mode allows
        return add(op, { edit: TEXT_KINDS.includes(kind) })
      },
      createConnector(fromId, toId) {
        const a = byId(fromId), b = byId(toId)
        if (!a || !b || a.kind === 'connector' || b.kind === 'connector') return null
        if (items().some((i) => i.kind === 'connector' && i.data.from === fromId && i.data.to === toId)) return null
        const box = boundsOf([a, b])
        const rect = { x: box.x, y: box.y, w: Math.max(20, box.w), h: Math.max(20, box.h) } // geometry is derived from the ends; this just satisfies validation
        return add(addOp('connector', rect, { from: fromId, to: toId }, topZ(items()) + 1))
      },
      async placeImage(file, pt = center()) {
        if (E.current.canCreate && !E.current.canCreate('image')) return // this board / stage takes no pictures (the server would refuse)
        try {
          const { src, w, h } = await fileToImage(file)
          const s = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h))
          const rect = { x: pt.x - (w * s) / 2, y: pt.y - (h * s) / 2, w: w * s, h: h * s }
          add(addOp('image', rect, { src }, nextZ(items(), 'image')))
        } catch (err) {
          E.current.ctl.notify(err instanceof ImageTooLarge ? 'Image too large' : "Couldn't read that image")
        }
      },
      deleteSelected() {
        const { ctl, setSelection } = E.current
        const ops = deleteOps(items(), editable(selected()).map((i) => i.id)).filter((o) => ctl.canEdit(byId(o.id)))
        if (!ops.length || !ctl.local(ops)) return
        setSelection(new Set())
        keepFocus(new Set(ops.map((o) => o.id)))
      },
      duplicateSelected() {
        const { ctl, setSelection } = E.current
        const { ops } = duplicateOps(items(), editable(selected()).map((i) => i.id))
        if (!ops.length || !ctl.local(ops)) return
        setSelection(new Set(ops.filter((o) => o.item.kind !== 'connector').map((o) => o.id)))
      },
      reorder(dir) {
        const ops = reorderOps(items(), editable(selected()).map((i) => i.id), dir)
        if (ops.length) E.current.ctl.local(ops)
      },
      nudge(dx, dy) {
        const { ctl, selection } = E.current
        const ids = movableIds(items(), selection, (i) => ctl.canEdit(i))
        if (!ids.length) return
        const moves = new Map(ids.map((id) => { const i = byId(id); return [id, { x: i.x + dx, y: i.y + dy }] }))
        ctl.local(patchOps(moves), { mergeKey: `nudge:${[...ids].sort().join(',')}` })
      },
      // { color } recolours selected notes/shapes; { shapeKind } re-shapes selected shapes. Also becomes the default for new ones.
      restyle(change) {
        const { ctl, selection, setStyle, tool } = E.current
        const sel = editable([...selection].map(byId).filter(Boolean))
        const ops = []
        for (const i of sel) {
          if (change.color && (i.kind === 'shape' || (i.kind === 'note' && change.color !== 'none'))) ops.push({ op: 'update', id: i.id, patch: { data: { color: change.color } } })
          if (change.shapeKind && i.kind === 'shape') ops.push({ op: 'update', id: i.id, patch: { data: { shape: change.shapeKind } } })
        }
        if (ops.length) ctl.local(ops)
        const kinds = new Set(sel.map((i) => i.kind))
        if (tool === 'note' || tool === 'shape') kinds.add(tool)
        const next = {}
        if (change.color && kinds.has('note') && change.color !== 'none') next.note = change.color
        if (change.color && kinds.has('shape')) next.shape = change.color
        if (change.shapeKind) next.shapeKind = change.shapeKind
        setStyle(next)
      },
      selectAll() {
        E.current.setSelection(new Set(items().filter((i) => i.kind !== 'connector').map((i) => i.id)))
      },
      startEdit() {
        const sel = editable(selected())
        if (sel.length !== 1 || !TEXT_KINDS.includes(sel[0].kind)) return false
        E.current.setEditing(sel[0].id)
        return true
      },
    }
  }
  return api.current
}
