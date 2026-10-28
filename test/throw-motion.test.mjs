import test from 'node:test'
import assert from 'node:assert/strict'
import { arcPosition, spinAt, impactParticles, createThrowLimiter, createGate, FLIGHT_MS, MAX_FLYING, ANNOUNCE_GAP_MS } from '../src/ui/throwMotion.js'

const A = { x: 100, y: 500 }
const B = { x: 400, y: 100 }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test('arcPosition starts at the origin, ends exactly on the target, and clamps t', () => {
  assert.deepEqual(arcPosition(A, B, 0), A)
  assert.deepEqual(arcPosition(A, B, 1), B)
  assert.deepEqual(arcPosition(A, B, -3), A)
  assert.deepEqual(arcPosition(A, B, 7), B)
  assert.deepEqual(arcPosition(A, B, NaN), A)
})

test('the arc rises above the straight line in the middle and x advances steadily', () => {
  const mid = arcPosition(A, B, 0.5)
  const straightY = (A.y + B.y) / 2
  assert.ok(mid.y < straightY - 20, `lifted: ${mid.y} vs ${straightY}`) // screen y grows downward
  let lastX = -Infinity
  for (let i = 0; i <= 20; i++) {
    const p = arcPosition(A, B, i / 20)
    assert.ok(p.x >= lastX)
    lastX = p.x
    assert.ok(Number.isFinite(p.y))
  }
})

test('a throw at the spot it started from, or straight up/down/sideways, never produces NaN', () => {
  for (const to of [A, { x: A.x, y: 0 }, { x: A.x, y: 900 }, { x: 900, y: A.y }, { x: A.x + 1e-9, y: A.y }]) {
    for (const t of [0, 0.25, 0.5, 1]) {
      const p = arcPosition(A, to, t)
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify([to, t]))
    }
  }
  assert.deepEqual(arcPosition(A, A, 0.5).x, A.x)
})

test('the lift is bounded, so a far target does not send the emoji off the screen', () => {
  const far = arcPosition({ x: 0, y: 1000 }, { x: 100_000, y: 1000 }, 0.5)
  assert.ok(far.y > 1000 - 400, String(far.y))
})

test('spinAt eases from 0 to whole turns, so the emoji lands upright', () => {
  assert.equal(spinAt(0), 0)
  assert.equal(spinAt(-1), 0)
  assert.ok(spinAt(1) % 360 === 0 && spinAt(1) >= 360)
  assert.equal(spinAt(2), spinAt(1))
  let last = -1
  for (let i = 0; i <= 10; i++) { const s = spinAt(i / 10); assert.ok(s >= last); last = s }
  assert.equal(spinAt(NaN), 0)
})

test('impactParticles is deterministic for a given rand and stays within a small radius', () => {
  const seq = () => { let i = 0; return () => ((i++ * 0.37) % 1) }
  const a = impactParticles(seq())
  const b = impactParticles(seq())
  assert.deepEqual(a, b)
  assert.ok(a.length >= 6 && a.length <= 12)
  for (const p of a) {
    assert.ok(Math.hypot(p.dx, p.dy) <= 90 && Math.hypot(p.dx, p.dy) >= 20, JSON.stringify(p))
    assert.ok(p.size >= 3 && p.size <= 8)
  }
  assert.notDeepEqual(impactParticles(() => 0), impactParticles(() => 0.99))
  const spread = new Set(a.map((p) => Math.round(Math.atan2(p.dy, p.dx) * 4)))
  assert.ok(spread.size >= 5, 'the particles fan out around the target')
})

test('constants', () => {
  assert.ok(FLIGHT_MS >= 400 && FLIGHT_MS <= 900)
  assert.equal(MAX_FLYING, 12)
  assert.equal(ANNOUNCE_GAP_MS, 2000)
})

test('the sender limiter allows a burst of 3 per sliding 4.5 s and then refuses until the oldest throw is 4.5 s old', () => {
  let now = 10_000
  const lim = createThrowLimiter({ now: () => now })
  assert.equal(lim.tryThrow(), true)
  now = 10_100
  assert.equal(lim.tryThrow(), true)
  now = 10_200
  assert.equal(lim.tryThrow(), true)
  assert.equal(lim.tryThrow(), false)
  assert.equal(lim.waitMs(), 4300)
  now = 14_499
  assert.equal(lim.tryThrow(), false, 'refusals are not counted and do not extend the wait')
  assert.equal(lim.waitMs(), 1)
  now = 14_500
  assert.equal(lim.waitMs(), 0)
  assert.equal(lim.tryThrow(), true)
  assert.equal(lim.tryThrow(), false, 'the second and third throws of the first burst are still inside the window')
  now = 14_600
  assert.equal(lim.tryThrow(), true)
})

test('whatever the window alignment, three-per-sliding-window never puts more than 3 into any fixed 4.5 s window', () => {
  let now = 0
  const lim = createThrowLimiter({ now: () => now })
  const sent = []
  for (let t = 0; t < 120_000; t += 137) { now = t; if (lim.tryThrow()) sent.push(t) }
  for (let start = 0; start < 120_000; start += 250) assert.ok(sent.filter((t) => t >= start && t < start + 4500).length <= 3, String(start))
  assert.ok(sent.length >= 75, 'and it still lets a steady stream through')
})

test('the announce gate lets one through per gap', () => {
  let now = 0
  const gate = createGate(2000, () => now)
  assert.equal(gate(), true)
  now = 1999
  assert.equal(gate(), false)
  now = 2000
  assert.equal(gate(), true)
  assert.equal(gate(), false)
})
