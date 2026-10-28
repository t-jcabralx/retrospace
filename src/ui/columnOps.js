// Settings → Columns as ordinary item ops (so presence, undo, live sync and permissions behave as for any edit). A
// column is a frame whose data has col: true; free frames the owner drew are not columns until "Use as column".
import { MAX_COLUMNS, splitTitle, joinTitle, nextColumnRect } from '../lib/columns.js'
import { itemsFullyInside } from './geometry.js'
import { addOp, deleteOps, nextZ } from './ops.js'

export const isColumn = (i) => i.kind === 'frame' && i.data?.col === true
export const columnFrames = (items) => items.filter(isColumn).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
export const freeFrames = (items) => items.filter((i) => i.kind === 'frame' && !isColumn(i))
export const canAddColumn = (items) => columnFrames(items).length < MAX_COLUMNS

// A frame's { emoji, title } as the editor shows them.
export const columnParts = (frame) => splitTitle(frame.data?.title ?? '')

// A data patch is merged key by key (plan.js, client/state.js), so only the changed keys are sent, and a flag is turned off with false.
export const retitleOp = (frame, { title, emoji }) => ({ op: 'update', id: frame.id, patch: { data: { title: joinTitle({ title, emoji: emoji || '' }) } } })

// Swaps the frame with its neighbour in dir (-1 left, +1 right). Both frames carry the notes fully inside them, and the
// pair keeps its total span (and the gap between them) when their widths differ. -> ops ([] at an end).
export function moveColumnOps(items, id, dir) {
  const cols = columnFrames(items)
  const i = cols.findIndex((c) => c.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= cols.length) return []
  const [left, right] = i < j ? [cols[i], cols[j]] : [cols[j], cols[i]]
  const gap = right.x - (left.x + left.w)
  const newLeftX = left.x
  const newRightX = left.x + right.w + gap // `right` now sits first and `left` after it
  const dxRight = newLeftX - right.x
  const dxLeft = newRightX - left.x
  const others = items.filter((x) => x.id !== left.id && x.id !== right.id)
  const carried = new Map() // id -> dx, each item belongs to at most one of the two
  for (const c of itemsFullyInside(left, others)) carried.set(c.id, dxLeft)
  for (const c of itemsFullyInside(right, others)) if (!carried.has(c.id)) carried.set(c.id, dxRight)
  const byId = new Map(items.map((x) => [x.id, x]))
  return [
    { op: 'update', id: left.id, patch: { x: left.x + dxLeft } },
    { op: 'update', id: right.id, patch: { x: right.x + dxRight } },
    ...[...carried].map(([cid, dx]) => ({ op: 'update', id: cid, patch: { x: byId.get(cid).x + dx } })),
  ]
}

// A new column to the right of the last one, same size and row. -> one add op, or null at the maximum.
export function addColumnOp(items, { title, emoji = '' }, makeId) {
  if (!canAddColumn(items)) return null
  const cols = columnFrames(items)
  const rect = nextColumnRect(cols)
  return addOp('frame', rect, { title: joinTitle({ title, emoji }), col: true }, nextZ(items, 'frame'), makeId?.())
}

// Removing a column deletes only the frame (and connectors attached to it): the notes inside stay on the board.
export const removeColumnOps = (items, id) => deleteOps(items, [id])

export const markAsColumnOp = (frame) => ({ op: 'update', id: frame.id, patch: { data: { col: true } } })
export const freeColumnOp = (frame) => ({ op: 'update', id: frame.id, patch: { data: { col: false } } })
