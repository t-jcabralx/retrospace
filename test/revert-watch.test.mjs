import test from 'node:test'
import assert from 'node:assert/strict'
import { revertedBy, causeOf, frameOf } from '../src/ui/revertWatch.js'

const items = (o) => new Map(Object.entries(o).map(([id, v]) => [id, { id, ...v }]))
const mine = (at, f) => new Map([['a', { at, ...f }]])

test('an item the viewer left at a position that an incoming copy then changes is reported with the reason', () => {
  const before = items({ a: { x: 90, y: 95, w: 200, h: 200 } })
  const after = items({ a: { x: 10, y: 20, w: 200, h: 200 } })
  assert.deepEqual(revertedBy('remote', before, after, mine(1000, { x: 90, y: 95, w: 200, h: 200 }), 2000), [{ id: 'a', cause: 'a refresh from the server', type: 'remote' }])
  assert.equal(revertedBy('peer-drag-expire', before, after, mine(1000, { x: 90, y: 95, w: 200, h: 200 }), 2000)[0].cause, 'a temporary position timing out')
})

test('nothing is reported when the item stayed, was changed by the viewer, is old, or the action is not an incoming change', () => {
  const same = items({ a: { x: 90, y: 95, w: 200, h: 200 } })
  const m = () => mine(1000, { x: 90, y: 95, w: 200, h: 200 })
  assert.deepEqual(revertedBy('remote', same, new Map(same), m(), 2000), [])
  const moved = items({ a: { x: 10, y: 20, w: 200, h: 200 } })
  assert.deepEqual(revertedBy('remote', moved, items({ a: { x: 5, y: 5, w: 200, h: 200 } }), m(), 2000), [], 'it was not where the viewer left it to begin with')
  assert.deepEqual(revertedBy('remote', same, moved, m(), 1000 + 31_000), [], 'older than 30 s')
  assert.deepEqual(revertedBy('local', same, moved, m(), 2000), [])
  assert.equal(causeOf('vote-local'), null)
})

test('frameOf keeps only the numbers that give an item its place and size', () => {
  assert.deepEqual(frameOf({ x: 1, y: 2, w: 3, h: 4, data: { text: 'x' }, z: 9 }), { x: 1, y: 2, w: 3, h: 4 })
  assert.deepEqual(frameOf({ x: 1, w: NaN }), { x: 1 })
})
