import test from 'node:test'
import assert from 'node:assert/strict'
import { spinAt, view, msLeft } from '../src/ui/event/timeline.js'
import { defaultWheel, applyAction, spinAngle, SPIN } from '../src/lib/wheel.js'

const spin = { id: 1, step: 'prize', index: 2, count: 5, startAt: 10_000, durationMs: 5000 }
const target = spinAngle(2, 5)

test('before the start the ring waits, then turns, then rests exactly at the target', () => {
  assert.deepEqual(spinAt(spin, 9000), { phase: 'waiting', angle: 0 })
  const mid = spinAt(spin, 12_500)
  assert.equal(mid.phase, 'spinning')
  assert.ok(mid.angle > 0 && mid.angle < target)
  assert.deepEqual(spinAt(spin, 15_000), { phase: 'done', angle: target })
  assert.deepEqual(spinAt(spin, 99_999), { phase: 'done', angle: target })
})

test('the angle only ever grows while spinning and it slows down towards the end', () => {
  let last = -1
  let lastStep = Infinity
  for (let t = 10_000; t <= 15_000; t += 250) {
    const a = spinAt(spin, t).angle
    assert.ok(a >= last, `${t}`)
    if (t > 10_000) { const step = a - last; assert.ok(step <= lastStep + 1e-9, `slows at ${t}`); lastStep = step }
    last = a
  }
})

test('reduced motion goes straight to the finished state', () => {
  assert.deepEqual(spinAt(spin, 9000, true), { phase: 'done', angle: target })
})

test('joining late shows the finished result, joining mid-spin shows the same moment as everyone else', () => {
  const a = spinAt(spin, 12_000)
  const b = spinAt({ ...spin }, 12_000)
  assert.deepEqual(a, b)
  assert.equal(spinAt(spin, 40_000).phase, 'done')
})

function round() {
  const base = { ...defaultWheel(), participants: ['A', 'B', 'C'].map((name, i) => ({ id: `p${i}`, name, on: true })), prizes: [{ id: 'z0', name: 'Mug', emoji: '', qty: 1, color: '#000000' }, { id: 'z1', name: 'Pen', emoji: '', qty: 1, color: '#111111' }] }
  const one = applyAction(base, 'spin-prize', { now: 1000, pick: () => 1 }).wheel
  const two = applyAction(one, 'spin-winner', { now: 1000 + 7000, pick: () => 2 }).wheel
  return { base, one, two }
}

test('view: idle shows nothing; the prize result is held back until its ring stops', () => {
  const { base, one } = round()
  assert.deepEqual(view(base, 0), { outer: 0, inner: 0, turning: null, prize: null, winner: null, prizeShown: false, winnerShown: false })
  const during = view(one, one.round.spin.startAt + 1000)
  assert.equal(during.turning, 'prize')
  assert.equal(during.prizeShown, false)
  assert.equal(during.prize.name, 'Pen')
  const done = view(one, one.round.spin.startAt + one.round.spin.durationMs)
  assert.equal(done.turning, null)
  assert.equal(done.prizeShown, true)
  assert.equal(done.inner, spinAngle(1, 2)) // Pen is the second of the two prizes with some left
})

test('view: in the winner step the prize rests under the pointer and the winner is held back until the outer ring stops', () => {
  const { two } = round()
  const sp = two.round.spin
  const during = view(two, sp.startAt + 2000)
  assert.equal(during.turning, 'winner')
  assert.equal(during.prizeShown, true)
  assert.equal(during.winnerShown, false)
  assert.equal(during.inner, spinAngle(1, 2))
  assert.ok(during.outer > 0 && during.outer < spinAngle(2, 3))
  const done = view(two, sp.startAt + sp.durationMs + 1)
  assert.deepEqual([done.turning, done.winnerShown, done.outer], [null, true, spinAngle(2, 3)])
  assert.equal(done.winner.name, 'C')
})

test('view: after a skip or back there is no spin record, the prize stays shown and no winner is', () => {
  const { one } = round()
  const noSpin = { ...one, round: { ...one.round, spin: null } }
  const v = view(noSpin, 5)
  assert.deepEqual([v.turning, v.prizeShown, v.winnerShown, v.winner], [null, true, false, null])
  assert.equal(v.inner, spinAngle(1, 2))
})

test('view: reduced motion shows results at once, and msLeft counts down to the end of the spin', () => {
  const { one, two } = round()
  assert.equal(view(one, one.round.spin.startAt - 500, true).prizeShown, true)
  assert.equal(msLeft(two, two.round.spin.startAt + 1000), SPIN.winnerMs - 1000)
  assert.equal(msLeft(two, two.round.spin.startAt + SPIN.winnerMs + 5), 0)
  assert.equal(msLeft(defaultWheel(), 1), 0)
})
