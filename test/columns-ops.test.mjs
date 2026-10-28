import test from 'node:test'
import assert from 'node:assert/strict'
import { columnFrames, freeFrames, columnParts, retitleOp, moveColumnOps, addColumnOp, removeColumnOps, markAsColumnOp, freeColumnOp, canAddColumn } from '../src/ui/columnOps.js'
import { layoutColumns, MAX_COLUMNS } from '../src/lib/columns.js'
import { initialState, reducer } from '../src/client/state.js'
import { validateOp } from '../src/lib/validate.js'

const cols = layoutColumns([{ title: 'Start', emoji: '🚦' }, { title: 'Stop' }, { title: 'Continue' }])
const note = (id, x, y = 200) => ({ id, kind: 'note', x, y, w: 100, h: 100, z: 1, rot: 0, data: { text: id, color: 'yellow' } })
const base = () => [...structuredClone(cols), note('n1', 20), note('n2', 400), note('free', 5000), { id: 'free-frame', kind: 'frame', x: 0, y: -400, w: 300, h: 100, z: -1, rot: 0, data: { title: 'Mine' } }]

// Applies ops the way the board does (validated, then reduced) and returns the item map.
function apply(items, ops) {
  for (const o of ops) assert.equal(validateOp(o).ok, true, JSON.stringify(o))
  const snapshot = { board: { code: 'ABCDEF' }, items: structuredClone(items), viewer: {} }
  const st = reducer(initialState(snapshot), { type: 'local', ops })
  return [...st.items.values()]
}
const at = (items, id) => items.find((i) => i.id === id)

test('columnFrames lists only col:true frames, left to right; free frames are separate', () => {
  const items = base().reverse()
  assert.deepEqual(columnFrames(items).map((c) => c.id), ['starter-col-1', 'starter-col-2', 'starter-col-3'])
  assert.deepEqual(freeFrames(items).map((c) => c.id), ['free-frame'])
})

test('columnParts splits an emoji prefix; retitleOp keeps the other data and puts the emoji back', () => {
  assert.deepEqual(columnParts(cols[0]), { emoji: '🚦', title: 'Start' })
  const op = retitleOp(cols[1], { title: 'Halt', emoji: '🛑' })
  assert.deepEqual(op.patch.data, { title: '🛑 Halt' })
  assert.equal(retitleOp(cols[0], { title: 'Go', emoji: '' }).patch.data.title, 'Go')
  assert.equal(validateOp(op).ok, true)
})

test('moveColumnOps swaps neighbours and carries the notes inside; ends and free notes are untouched', () => {
  const items = base()
  const ops = moveColumnOps(items, 'starter-col-1', 1)
  const after = apply(items, ops)
  assert.deepEqual(columnFrames(after).map((c) => c.id), ['starter-col-2', 'starter-col-1', 'starter-col-3'])
  assert.equal(at(after, 'starter-col-2').x, 0)
  assert.equal(at(after, 'starter-col-1').x, 384)
  assert.equal(at(after, 'n1').x, 20 + 384, 'a note of the moved column goes with it')
  assert.equal(at(after, 'n2').x, 400 - 384, 'and so does the neighbour\'s')
  assert.equal(at(after, 'free').x, 5000)
  assert.deepEqual(moveColumnOps(items, 'starter-col-1', -1), [])
  assert.deepEqual(moveColumnOps(items, 'starter-col-3', 1), [])
  assert.deepEqual(moveColumnOps(items, 'nope', 1), [])
  assert.deepEqual(moveColumnOps(items, 'free-frame', 1), [])
})

test('moveColumnOps keeps the span when widths differ and never overlaps', () => {
  const items = [{ ...cols[0], w: 200 }, { ...cols[1], x: 224, w: 500 }, { ...cols[2], x: 748 }]
  const after = apply(items, moveColumnOps(items, 'starter-col-2', -1))
  const [a, b] = columnFrames(after)
  assert.deepEqual([a.id, a.x, b.id, b.x], ['starter-col-2', 0, 'starter-col-1', 524])
  assert.equal(a.x + a.w + 24, b.x)
})

test('addColumnOp appends to the right with the same size, behind everything, flagged; refuses past the maximum', () => {
  const items = base()
  const op = addColumnOp(items, { title: 'New', emoji: '🎯' }, () => 'new-col')
  assert.equal(validateOp(op).ok, true)
  assert.deepEqual([op.id, op.item.x, op.item.y, op.item.w, op.item.h], ['new-col', 3 * 384, 140, 360, 640])
  assert.deepEqual(op.item.data, { title: '🎯 New', col: true })
  assert.ok(op.item.z < 0)
  let many = items
  while (canAddColumn(many)) many = apply(many, [addColumnOp(many, { title: 'x' })])
  assert.equal(columnFrames(many).length, MAX_COLUMNS)
  assert.equal(addColumnOp(many, { title: 'x' }), null)
  assert.equal(addColumnOp([], { title: 'first' }).item.x, 0, 'the first column of a board starts at the origin')
})

test('removeColumnOps deletes the frame only: the notes inside stay', () => {
  const items = base()
  const after = apply(items, removeColumnOps(items, 'starter-col-1'))
  assert.equal(at(after, 'starter-col-1'), undefined)
  assert.ok(at(after, 'n1'))
})

test('markAsColumnOp / freeColumnOp toggle the flag and keep the title', () => {
  const free = base().find((i) => i.id === 'free-frame')
  const on = markAsColumnOp(free)
  const after = apply([free], [on])
  assert.deepEqual(after[0].data, { title: 'Mine', col: true })
  assert.deepEqual(apply(after, [freeColumnOp(after[0])])[0].data, { title: 'Mine', col: false })
  assert.deepEqual(columnFrames(apply(after, [freeColumnOp(after[0])])), [])
})
