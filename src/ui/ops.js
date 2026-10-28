// Pure builders for the ops the canvas sends. They take plain item arrays and return client ops
// ({ op: 'add' | 'update' | 'delete', ... }) so the interaction code stays free of bookkeeping.
import { freshId } from '../client/state.js'
import { itemsFullyInside } from './geometry.js'
import { NOTE_COLORS } from '../lib/validate.js'

export { NOTE_COLORS } // one list for notes, cards and the server's card rule
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond']

// A note colour name from stored data -> CSS value; anything unknown falls back to yellow.
export const noteColor = (c) => `var(--note-${NOTE_COLORS.includes(c) ? c : 'yellow'})`

// Default size and data per creatable kind.
export const DEFAULTS = {
  note: { w: 180, h: 180, data: (o) => ({ text: '', color: o.color || 'yellow' }) },
  text: { w: 240, h: 48, data: () => ({ text: '' }) },
  shape: { w: 160, h: 120, data: (o) => ({ shape: o.shape || 'rect', text: '', color: o.color || 'blue' }) },
  frame: { w: 360, h: 260, data: () => ({ title: 'Frame' }) },
}

export const topZ = (items) => items.reduce((m, i) => Math.max(m, i.z ?? 0), 0)
export const bottomZ = (items) => items.reduce((m, i) => Math.min(m, i.z ?? 0), 0)

// Frames sit behind everything else, other kinds on top.
export const nextZ = (items, kind) => (kind === 'frame' ? bottomZ(items) - 1 : topZ(items) + 1)

export function addOp(kind, rect, data, z, id = freshId()) {
  return { op: 'add', id, item: { id, kind, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h), z, rot: 0, data } }
}

// Connectors follow their endpoints, so deleting an item takes the connectors attached to it along.
export function deleteOps(items, ids) {
  const gone = new Set(ids)
  for (const i of items) if (i.kind === 'connector' && (gone.has(i.data?.from) || gone.has(i.data?.to))) gone.add(i.id)
  return [...gone].filter((id) => items.some((i) => i.id === id)).map((id) => ({ op: 'delete', id }))
}

// Copies the selected non-connector items (and connectors that join two copied items), shifted by `offset`.
export function duplicateOps(items, ids, { offset = 24, makeId = freshId } = {}) {
  const wanted = new Set(ids)
  const src = items.filter((i) => wanted.has(i.id) && i.kind !== 'connector')
  const map = new Map(src.map((i) => [i.id, makeId()]))
  let z = topZ(items)
  const ops = src.map((i) => {
    const op = addOp(i.kind, { x: i.x + offset, y: i.y + offset, w: i.w, h: i.h }, structuredClone(i.data), i.kind === 'frame' ? i.z : ++z, map.get(i.id))
    if (i.anon) op.item.anon = true // a copy of an anonymous note stays anonymous
    return op
  })
  for (const c of items) {
    if (c.kind === 'connector' && map.has(c.data.from) && map.has(c.data.to)) {
      ops.push(addOp('connector', c, { from: map.get(c.data.from), to: map.get(c.data.to) }, ++z, makeId()))
    }
  }
  return { ops, ids: ops.map((o) => o.id) }
}

// Moves each selected item one step in the paint order (dir +1 forward, -1 backward) by taking a z just past
// its nearest unselected neighbour. Connectors are drawn in their own layer and do not take part.
export function reorderOps(items, ids, dir) {
  const sel = new Set(ids)
  const boxes = items.filter((i) => i.kind !== 'connector')
  const ops = []
  const used = new Map() // neighbour id -> how many selected items already passed it
  const scan = dir > 0 ? boxes.map((_, i) => boxes.length - 1 - i) : boxes.map((_, i) => i)
  for (const at of scan) {
    const item = boxes[at]
    if (!sel.has(item.id)) continue
    let j = at + dir
    while (boxes[j] && sel.has(boxes[j].id)) j += dir
    const other = boxes[j]
    if (!other) continue
    const n = (used.get(other.id) ?? 0) + 1
    used.set(other.id, n)
    ops.push({ op: 'update', id: item.id, patch: { z: other.z + dir * n } })
  }
  return ops
}

export const patchOps = (rects) => [...rects].map(([id, patch]) => ({ op: 'update', id, patch }))

// Undo re-adds deleted items under fresh ids (the server keeps a tombstone for the old one), which would
// orphan a re-added connector still pointing at the old ids. `map` is oldId -> newId; the connector adds in
// `ops` and in `state.items` are rewritten to match.
export function fixLinks(result, map) {
  if (!map.size) return result
  const fix = (data) => ({ ...data, from: map.get(data.from) ?? data.from, to: map.get(data.to) ?? data.to })
  const ops = result.ops.map((o) => (o.op === 'add' && o.item?.kind === 'connector' ? { ...o, item: { ...o.item, data: fix(o.item.data) } } : o))
  const items = new Map(result.state.items)
  for (const o of ops) {
    const cur = o.op === 'add' && o.item?.kind === 'connector' ? items.get(o.id) : null
    if (cur) items.set(o.id, { ...cur, data: fix(cur.data) })
  }
  return { state: { ...result.state, items }, ops }
}

// Ids that move when `ids` move: the items themselves plus everything a moved frame fully contains, minus
// connectors (they follow their endpoints) and whatever `canEdit` refuses. `canEdit` defaults to everything.
export function movableIds(items, ids, canEdit = () => true) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out = new Set()
  for (const id of ids) {
    const it = byId.get(id)
    if (!it || it.kind === 'connector') continue
    out.add(id)
    if (it.kind === 'frame') for (const c of itemsFullyInside(it, items)) out.add(c.id)
  }
  return [...out].filter((id) => canEdit(byId.get(id)))
}

const sameValues = (a, b) => Object.keys(b).every((k) => a[k] === b[k])

// What to do when a drag/resize (or a nudge) stops. `original` and `next` are Maps id -> patch ({x,y} or {x,y,w,h});
// `next` is null when nothing was moved. While dragging, intermediate values are streamed to the server untracked,
// so anything that does not end in a real change must put the streamed items back:
//   revert: ops that return the server (and peers) to `original`; empty when nothing was streamed.
//   commit: { restore, final } for ctl.commit(): the ONE tracked step from original to final, or null.
export function gestureEnd({ streamed = false, cancelled = false, original, next = null }) {
  const unchanged = !next || [...next].every(([id, patch]) => sameValues(original.get(id) ?? {}, patch))
  if (cancelled || unchanged) return { revert: streamed ? patchOps(original) : [], commit: null }
  return { revert: [], commit: { restore: patchOps(original), final: patchOps(next) } }
}

// Keeps only the newest pending update per item (later patches win key by key). Non-update ops pass through in order.
export function coalesceUpdates(ops) {
  const out = []
  const at = new Map()
  for (const o of ops) {
    if (o.op !== 'update') { out.push(o); continue }
    const i = at.get(o.id)
    if (i === undefined) { at.set(o.id, out.length); out.push(o); continue }
    const prev = out[i]
    const data = prev.patch.data || o.patch.data ? { data: { ...prev.patch.data, ...o.patch.data } } : {}
    out[i] = { op: 'update', id: o.id, patch: { ...prev.patch, ...o.patch, ...data } }
  }
  return out
}

// Removes the held-back live updates (a Map id -> op) for `ids`; returns how many were dropped.
export function dropBuffered(buf, ids) {
  let n = 0
  for (const id of ids) if (buf.delete(id)) n++
  return n
}
