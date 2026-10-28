import test from 'node:test'
import assert from 'node:assert/strict'
import { addOp, deleteOps, duplicateOps, reorderOps, fixLinks, nextZ } from '../src/ui/ops.js'
import { initialState, reducer, undo } from '../src/client/state.js'
import { validateOp } from '../src/lib/validate.js'

const it = (id, extra = {}) => ({ id, kind: 'note', x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { text: id, color: 'yellow' }, ...extra })
const link = (id, from, to) => it(id, { kind: 'connector', data: { from, to } })

test('addOp builds an op the server validator accepts', () => {
  const op = addOp('note', { x: 10.4, y: 20.6, w: 180, h: 180 }, { text: '', color: 'yellow' }, 3)
  assert.equal(op.op, 'add')
  assert.equal(op.id, op.item.id)
  assert.ok(op.id.length <= 40)
  assert.equal(op.item.x, 10)
  assert.equal(op.item.y, 21)
  assert.equal(validateOp(op).ok, true)
})

test('nextZ puts frames behind and everything else in front', () => {
  const items = [it('a', { z: 2 }), it('b', { z: -1 })]
  assert.equal(nextZ(items, 'note'), 3)
  assert.equal(nextZ(items, 'frame'), -2)
})

test('deleteOps also deletes connectors attached to a deleted item, once', () => {
  const items = [it('a'), it('b'), it('c'), link('l1', 'a', 'b'), link('l2', 'b', 'c')]
  assert.deepEqual(deleteOps(items, ['a']).map((o) => o.id).sort(), ['a', 'l1'])
  assert.deepEqual(deleteOps(items, ['a', 'l1', 'b']).map((o) => o.id).sort(), ['a', 'b', 'l1', 'l2'])
  assert.deepEqual(deleteOps(items, ['missing']), [])
})

test('duplicateOps offsets copies, remaps the joining connector and skips lone connectors', () => {
  const items = [it('a', { x: 5, y: 5, z: 1 }), it('b', { x: 300, z: 2 }), it('c'), link('l1', 'a', 'b'), link('l2', 'b', 'c')]
  let n = 0
  const { ops, ids } = duplicateOps(items, ['a', 'b', 'l2'], { makeId: () => `n${++n}` })
  assert.deepEqual(ids, ['n1', 'n2', 'n3'])
  assert.equal(ops[0].item.x, 29)
  assert.equal(ops[0].item.y, 29)
  const conn = ops.find((o) => o.item.kind === 'connector')
  assert.deepEqual(conn.item.data, { from: 'n1', to: 'n2' })
  assert.ok(ops.every((o) => validateOp(o).ok))
  assert.deepEqual(duplicateOps(items, ['l1']).ops, [])
})

test('reorderOps moves one step past the nearest unselected neighbour', () => {
  const items = [it('a', { z: 1 }), it('b', { z: 2 }), it('c', { z: 5 })]
  assert.deepEqual(reorderOps(items, ['a'], 1), [{ op: 'update', id: 'a', patch: { z: 3 } }])
  assert.deepEqual(reorderOps(items, ['c'], -1), [{ op: 'update', id: 'c', patch: { z: 1 } }])
  assert.deepEqual(reorderOps(items, ['c'], 1), [])
  assert.deepEqual(reorderOps(items, ['a'], -1), [])
  // a and b together pass c
  assert.deepEqual(reorderOps(items, ['a', 'b'], 1).map((o) => o.patch.z).sort(), [6, 7])
})

test('fixLinks follows an undone delete: the re-added connector points at the re-added endpoints', () => {
  const snap = { board: { code: 'ABC234' }, items: [it('a'), it('b'), link('l', 'a', 'b')], people: [] }
  let s = initialState(snap)
  s = reducer(s, { type: 'local', ops: deleteOps([...s.items.values()], ['a']) })
  assert.equal(s.items.size, 1)
  const olds = s.undo.at(-1).ops.filter((o) => o.op === 'add').map((o) => o.id)
  const map = new Map()
  let k = 0
  const res = undo(s, () => { const id = `fresh${++k}`; map.set(olds[k - 1], id); return id })
  const fixed = fixLinks(res, map)
  const add = fixed.ops.find((o) => o.item?.kind === 'connector')
  assert.equal(add.item.data.from, map.get('a'))
  assert.equal(add.item.data.to, 'b')
  assert.equal(fixed.state.items.get(add.id).data.from, map.get('a'))
  assert.equal(fixLinks(res, new Map()), res)
})

test('movableIds adds a frame\'s contained items once, skips connectors and what canEdit refuses', async () => {
  const { movableIds } = await import('../src/ui/ops.js')
  const items = [
    it('f', { kind: 'frame', x: 0, y: 0, w: 400, h: 400, data: { title: 'F' } }),
    it('in', { x: 10, y: 10 }), it('out', { x: 500, y: 500 }), link('l', 'in', 'out'), it('mine', { x: 20, y: 200 }),
  ]
  assert.deepEqual(movableIds(items, ['f', 'in']).sort(), ['f', 'in', 'mine'])
  assert.deepEqual(movableIds(items, ['l', 'out']), ['out'])
  assert.deepEqual(movableIds(items, ['f'], (i) => i.id !== 'in').sort(), ['f', 'mine'])
})

// ---- gestureEnd: how a drag/resize/pinch interruption is settled ----
const orig = () => new Map([['a', { x: 10, y: 20 }], ['b', { x: 100, y: 40 }]])
const moved = () => new Map([['a', { x: 15, y: 25 }], ['b', { x: 105, y: 45 }]])

test('gestureEnd: a normal drop is one tracked step from the original to the final values, nothing reverted', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  const r = gestureEnd({ streamed: true, cancelled: false, original: orig(), next: moved() })
  assert.deepEqual(r.revert, [])
  assert.deepEqual(r.commit.restore, [{ op: 'update', id: 'a', patch: { x: 10, y: 20 } }, { op: 'update', id: 'b', patch: { x: 100, y: 40 } }])
  assert.deepEqual(r.commit.final.map((o) => o.patch), [{ x: 15, y: 25 }, { x: 105, y: 45 }])
})

test('gestureEnd: a cancelled drag (Esc, pointercancel) after streaming sends the originals back and commits nothing', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  const r = gestureEnd({ streamed: true, cancelled: true, original: orig(), next: moved() })
  assert.equal(r.commit, null)
  assert.deepEqual(r.revert.map((o) => [o.id, o.patch]), [['a', { x: 10, y: 20 }], ['b', { x: 100, y: 40 }]])
})

test('gestureEnd: a cancelled drag that never streamed sends nothing', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  assert.deepEqual(gestureEnd({ streamed: false, cancelled: true, original: orig(), next: moved() }), { revert: [], commit: null })
})

test('gestureEnd: a drop back at the start after streaming restores the server; without streaming it is a no-op', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  const same = new Map([['a', { x: 10, y: 20 }], ['b', { x: 100, y: 40 }]])
  const r = gestureEnd({ streamed: true, cancelled: false, original: orig(), next: same })
  assert.equal(r.commit, null)
  assert.equal(r.revert.length, 2)
  assert.deepEqual(gestureEnd({ streamed: false, cancelled: false, original: orig(), next: same }), { revert: [], commit: null })
  assert.deepEqual(gestureEnd({ streamed: false, cancelled: false, original: orig(), next: null }), { revert: [], commit: null })
})

test('gestureEnd: resize cancel and net-zero resize restore x/y/w/h; a real resize commits all four', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  const o = new Map([['r', { x: 0, y: 0, w: 100, h: 80 }]])
  const grown = new Map([['r', { x: 0, y: 0, w: 140, h: 80 }]])
  assert.deepEqual(gestureEnd({ streamed: true, cancelled: true, original: o, next: grown }).revert, [{ op: 'update', id: 'r', patch: { x: 0, y: 0, w: 100, h: 80 } }])
  assert.equal(gestureEnd({ streamed: true, cancelled: false, original: o, next: new Map([['r', { x: 0, y: 0, w: 100, h: 80 }]]) }).commit, null)
  const done = gestureEnd({ streamed: true, cancelled: false, original: o, next: grown })
  assert.deepEqual(done.commit.final, [{ op: 'update', id: 'r', patch: { x: 0, y: 0, w: 140, h: 80 } }])
  assert.deepEqual(done.commit.restore, [{ op: 'update', id: 'r', patch: { x: 0, y: 0, w: 100, h: 80 } }])
})

test('gestureEnd: a second finger interrupting a streamed drag (cancelled, no next yet) reverts like a cancel', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  const r = gestureEnd({ streamed: true, cancelled: true, original: orig() })
  assert.equal(r.commit, null)
  assert.equal(r.revert.length, 2)
})

test('the reverted state never differs from the original: revert applied after streaming leaves undo history untouched', async () => {
  const { gestureEnd } = await import('../src/ui/ops.js')
  let s = initialState({ board: { code: 'ABC234' }, items: [it('a', { x: 10, y: 20 })], people: [] })
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 50, y: 60 } }], track: false }) // an ack of a streamed step
  const { revert } = gestureEnd({ streamed: true, cancelled: true, original: new Map([['a', { x: 10, y: 20 }]]) })
  s = reducer(s, { type: 'local', ops: revert, track: false })
  assert.deepEqual([s.items.get('a').x, s.items.get('a').y], [10, 20])
  assert.equal(s.undo.length, 0)
})

// ---- coalesceUpdates ----
test('coalesceUpdates keeps one update per item (latest values win) and passes other ops through in order', async () => {
  const { coalesceUpdates } = await import('../src/ui/ops.js')
  const u = (id, patch) => ({ op: 'update', id, patch })
  const out = coalesceUpdates([u('a', { x: 1, y: 1 }), u('b', { x: 5 }), { op: 'delete', id: 'z' }, u('a', { x: 2 }), u('b', { x: 6, y: 7 }), u('a', { w: 30 })])
  assert.deepEqual(out, [u('a', { x: 2, y: 1, w: 30 }), u('b', { x: 6, y: 7 }), { op: 'delete', id: 'z' }])
  assert.deepEqual(coalesceUpdates([u('a', { data: { text: 'x' } }), u('a', { data: { color: 'pink' } })]), [u('a', { data: { text: 'x', color: 'pink' } })])
  assert.deepEqual(coalesceUpdates([]), [])
})

// ---- labels ----
test('itemLabel and connectorLabel give every item a readable name', async () => {
  const { itemLabel, connectorLabel } = await import('../src/ui/labels.js')
  assert.equal(itemLabel(it('a', { data: { text: 'Ship it' } })), 'Sticky note: Ship it')
  assert.equal(itemLabel(it('a', { data: { text: '' } })), 'Sticky note (empty)')
  assert.equal(itemLabel(it('a', { kind: 'text', data: { text: 'Hello' } })), 'Text: Hello')
  assert.equal(itemLabel(it('a', { kind: 'shape', data: { shape: 'ellipse', text: 'Why' } })), 'Shape (ellipse): Why')
  assert.equal(itemLabel(it('a', { kind: 'frame', data: { title: 'Went well' } })), 'Frame: Went well')
  assert.equal(itemLabel(it('a', { data: { text: 'Ship it' }, authorName: 'Brave Otter' })), 'Sticky note: Ship it, by Brave Otter', 'the stored author is read out')
  assert.equal(itemLabel(it('a', { data: { text: 'x' }, authorName: 'N'.repeat(40) })), `Sticky note: x, by ${'N'.repeat(23)}…`)
  assert.equal(itemLabel(it('a', { kind: 'frame', data: { title: '' } })), 'Frame (untitled)')
  assert.equal(itemLabel(it('a', { kind: 'image', data: { src: 'data:image/png;base64,AA' } })), 'Image')
  assert.equal(itemLabel(it('a', { data: { text: 'x'.repeat(100) } })).length, 'Sticky note: '.length + 60)
  const frame = it('f', { kind: 'frame', data: { title: 'Went well' } })
  assert.equal(connectorLabel(it('a', { data: { text: 'Ship it' } }), frame), 'Connector from Ship it to Went well')
  assert.equal(connectorLabel(it('a', { data: { text: '' } }), it('i', { kind: 'image', data: { src: 'x' } })), 'Connector from sticky note to image')
})

test('noteColor whitelists note colours', async () => {
  const { noteColor } = await import('../src/ui/ops.js')
  assert.equal(noteColor('pink'), 'var(--note-pink)')
  assert.equal(noteColor('red); background: url(x'), 'var(--note-yellow)')
})

test('dropBuffered removes held-back live updates for the given ids, present or not, and counts them', async () => {
  const { dropBuffered } = await import('../src/ui/ops.js')
  const buf = new Map([['a', { op: 'update', id: 'a', patch: { x: 1 } }], ['b', { op: 'update', id: 'b', patch: { x: 2 } }], ['c', { op: 'update', id: 'c', patch: { x: 3 } }]])
  assert.equal(dropBuffered(buf, ['a', 'gone', 'c']), 2)
  assert.deepEqual([...buf.keys()], ['b'])
  assert.equal(dropBuffered(buf, []), 0)
  assert.equal(dropBuffered(buf, ['b']), 1)
  assert.equal(buf.size, 0)
})
