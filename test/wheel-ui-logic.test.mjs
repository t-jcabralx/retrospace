import test from 'node:test'
import assert from 'node:assert/strict'
import { mainAction, sliceAtPointer, view } from '../src/ui/event/timeline.js'
import { defaultWheel, applyAction, spinAngle } from '../src/lib/wheel.js'

const base = () => ({ ...defaultWheel(), participants: ['A', 'B', 'C'].map((name, i) => ({ id: `p${i}`, name, on: true })), prizes: [{ id: 'z0', name: 'Mug', emoji: '', qty: 1, color: '#000000' }, { id: 'z1', name: 'Pen', emoji: '', qty: 1, color: '#111111' }] })
const go = (w, a, now, pick = () => 0) => applyAction(w, a, { now, pick }).wheel

test('the main action follows the round and is held back while a spin is turning', () => {
  const w = base()
  assert.deepEqual(mainAction(w, view(w, 0), 0), { action: 'spin-prize', text: 'Spin for the prize', spin: true, off: false, why: '' })
  const one = go(w, 'spin-prize', 1000)
  assert.equal(mainAction(one, view(one, 2000), 2000), null) // turning
  const after = one.round.spin.startAt + one.round.spin.durationMs + 1
  assert.equal(mainAction(one, view(one, after), after).action, 'spin-winner')
  const two = go(one, 'spin-winner', after)
  const end = two.round.spin.startAt + two.round.spin.durationMs + 1
  assert.deepEqual(mainAction(two, view(two, end), end), { action: 'accept', text: 'Accept winner', spin: false })
})

test('the main action explains why it cannot start', () => {
  const none = { ...base(), participants: [] }
  const m = mainAction(none, view(none, 0), 0)
  assert.equal(m.off, true)
  assert.match(m.why, /person/)
  assert.match(mainAction({ ...base(), prizes: [] }, view(base(), 0), 0).why, /prize/)
})

test('the slice under the pointer matches where spinAngle puts the chosen slice', () => {
  for (const count of [2, 3, 8, 24]) for (const index of [0, 1, count - 1]) assert.equal(sliceAtPointer(spinAngle(index, count), count), index, `${index}/${count}`)
  assert.equal(sliceAtPointer(0, 4), 0)
  assert.equal(sliceAtPointer(90, 4), 3) // turned a quarter clockwise: the last slice has come round to the top
  assert.equal(sliceAtPointer(5, 0), 0)
})
