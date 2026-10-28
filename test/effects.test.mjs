import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, step, merge, MAX_PARTICLES, EFFECTS, DEFAULT_COUNT } from '../src/ui/effects-engine.js'
import { createRunner } from '../src/ui/effects-runner.js'

const B = { w: 1000, h: 700 }
// A small deterministic generator (mulberry32) so "deterministic given rand" can be shown with two equal streams.
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const inside = (p) => p.x >= 0 && p.x <= B.w && p.y >= 0 && p.y <= B.h
const run = (list, seconds, dt = 1 / 60, rand = seeded(9)) => {
  for (let t = 0; t < seconds; t += dt) list = step(list, dt, B, rand)
  return list
}

test('the engine knows exactly the three effects the server whitelists', () => {
  assert.deepEqual([...EFFECTS].sort(), ['balloons', 'confetti', 'fireworks'])
  for (const e of EFFECTS) assert.ok(DEFAULT_COUNT[e] > 0 && DEFAULT_COUNT[e] <= MAX_PARTICLES)
})

test('spawn(confetti, 100) returns 100 particles that all start inside the bounds', () => {
  const list = spawn('confetti', 100, B, seeded(1))
  assert.equal(list.length, 100)
  assert.ok(list.every(inside))
  assert.ok(list.every((p) => p.kind === 'confetti' && p.ttl > 0 && p.size > 0 && typeof p.color === 'string'))
  assert.ok(new Set(list.map((p) => p.color)).size > 3, 'a mix of colours')
})

test('balloons rise: every balloon starts inside the bounds with vy < 0', () => {
  const list = spawn('balloons', 20, B, seeded(2))
  assert.equal(list.length, 20)
  assert.ok(list.every((p) => p.kind === 'balloon' && p.vy < 0 && inside(p)))
  const later = run(list, 2)
  assert.equal(later.length, 20, 'none has left yet')
  assert.ok(later.every((p, i) => p.y < list[i].y), 'and they keep going up')
})

test('fireworks: rockets climb, then burst into radial sparks after their fuse and disappear', () => {
  const rockets = spawn('fireworks', 3, B, seeded(3))
  assert.equal(rockets.length, 3)
  assert.ok(rockets.every((p) => p.kind === 'rocket' && p.fuse > 0 && inside(p)))
  // Run until a burst has happened.
  let list = rockets
  let t = 0
  while (t < 5 && !list.some((p) => p.kind === 'spark')) { list = step(list, 1 / 60, B, seeded(4)); t += 1 / 60 }
  const sparks = list.filter((p) => p.kind === 'spark')
  assert.ok(sparks.length >= 20, `burst of ${sparks.length}`)
  const angles = new Set(sparks.map((s) => Math.round(Math.atan2(s.vy, s.vx) * 4)))
  assert.ok(angles.size >= 12, 'sparks fly in many directions')
  const mx = sparks.reduce((a, s) => a + s.vx, 0) / sparks.length
  const my = sparks.reduce((a, s) => a + s.vy, 0) / sparks.length
  assert.ok(Math.abs(mx) < 60 && Math.abs(my) < 60, 'radial: the burst has no net drift')
  assert.ok(list.filter((p) => p.kind === 'rocket').length < rockets.length, 'the rocket that burst is gone')
  assert.ok(run(list, 6).length === 0, 'everything burns out')
})

test('step removes expired particles', () => {
  const list = spawn('confetti', 50, B, seeded(5))
  const short = list.map((p) => ({ ...p, ttl: 0.5 }))
  assert.equal(step(short, 0.4, B).length, 50)
  assert.equal(step(short, 0.6, B).length, 0)
  assert.equal(run(list, 12).length, 0, 'whatever the ttl, a few seconds later nothing is left')
})

test('step removes particles that left the screen (fallen below, flown past the sides or off the top for balloons)', () => {
  const base = { kind: 'confetti', vx: 0, vy: 0, size: 8, rot: 0, vr: 0, color: '#fff', age: 0, ttl: 100, drag: 0, gravity: 0, wind: 0, phase: 0, id: 1 }
  const list = [
    { ...base, id: 1, x: 500, y: 800 + 100 }, { ...base, id: 2, x: -400, y: 300 }, { ...base, id: 3, x: B.w + 400, y: 300 }, { ...base, id: 4, x: 500, y: 300 },
    { ...base, kind: 'balloon', id: 5, x: 500, y: -300 },
  ]
  assert.deepEqual(step(list, 0.01, B).map((p) => p.id), [4])
  assert.equal(step([{ ...base, x: 500, y: -50 }], 0.01, B).length, 1, 'confetti shot above the top is still on its way back down')
})

test('gravity pulls confetti down and drag slows it; a particle never gets NaN values', () => {
  const p = { kind: 'confetti', id: 1, x: 500, y: 300, vx: 400, vy: -400, size: 8, rot: 0, vr: 3, color: '#fff', age: 0, ttl: 10, drag: 2, gravity: 500, wind: 20, phase: 1 }
  let list = [p]
  const speed = (q) => Math.hypot(q.vx, q.vy)
  for (let i = 0; i < 30; i++) list = step(list, 1 / 60, B)
  assert.ok(Number.isFinite(list[0].x) && Number.isFinite(list[0].y) && Number.isFinite(list[0].rot))
  assert.ok(speed(list[0]) < speed(p), 'drag slows it down')
  const later = run(list, 1)
  assert.ok(later[0].vy > 0, 'gravity wins in the end')
  const huge = step([p], 1e9, B)
  assert.deepEqual(huge, [], 'a huge dt expires it instead of exploding')
})

test('step does not change its input', () => {
  const list = spawn('confetti', 5, B, seeded(6))
  const copy = structuredClone(list)
  step(list, 0.1, B)
  assert.deepEqual(list, copy)
})

test('deterministic: the same rand gives the same particles, for spawn and for a whole fireworks run', () => {
  for (const e of EFFECTS) assert.deepEqual(spawn(e, 30, B, seeded(11)), spawn(e, 30, B, seeded(11)), e)
  assert.notDeepEqual(spawn('confetti', 30, B, seeded(11)), spawn('confetti', 30, B, seeded(12)))
  assert.deepEqual(run(spawn('fireworks', 4, B, seeded(7)), 3, 1 / 30, seeded(8)), run(spawn('fireworks', 4, B, seeded(7)), 3, 1 / 30, seeded(8)))
})

test('the hard cap: spawn clamps the count, merge keeps 250, and a firework burst can never push step past 250', () => {
  assert.equal(MAX_PARTICLES, 250)
  assert.equal(spawn('confetti', 10_000, B, seeded(1)).length, 250)
  assert.equal(spawn('confetti', 0, B, seeded(1)).length, 0)
  assert.equal(spawn('confetti', -5, B, seeded(1)).length, 0)
  assert.equal(spawn('confetti', 12.9, B, seeded(1)).length, 12)
  assert.equal(spawn('confetti', NaN, B, seeded(1)).length, 0)
  assert.deepEqual(spawn('nonsense', 10, B, seeded(1)), [])
  const a = spawn('confetti', 200, B, seeded(1))
  const b = spawn('balloons', 200, B, seeded(2))
  assert.equal(merge(a, b).length, 250)
  assert.deepEqual(merge(a, b).slice(-200), b, 'the newest particles are the ones kept')
  assert.equal(merge(a, []).length, 200)
  let list = spawn('fireworks', 250, B, seeded(3)).map((p) => ({ ...p, delay: 0, fuse: 0.05 }))
  list = step(list, 0.1, B, seeded(4))
  assert.ok(list.length <= 250)
})

test('a degenerate size (0 x 0) does not throw or produce NaN', () => {
  const list = spawn('confetti', 10, { w: 0, h: 0 }, seeded(1))
  assert.ok(list.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  step(list, 0.016, { w: 0, h: 0 })
})

// ---- the frame loop ----
function loop() {
  let id = 0
  const frames = new Map()
  const drawn = []
  const state = { idle: 0 }
  const runner = createRunner({
    requestFrame: (fn) => { frames.set(++id, fn); return id },
    cancelFrame: (i) => frames.delete(i),
    getBounds: () => B,
    draw: (list) => drawn.push(list.length),
    onIdle: () => { state.idle++ },
    rand: seeded(21),
  })
  let t = 0
  const frame = (ms = 16) => { t += ms; const [[i, fn]] = [...frames]; frames.delete(i); fn(t) }
  return { runner, frames, drawn, state, frame }
}

test('the loop runs only while particles exist: no frame is requested until fire, and none after they are gone', () => {
  const { runner, frames, frame, state, drawn } = loop()
  assert.equal(frames.size, 0)
  assert.equal(runner.fire('confetti'), true)
  assert.equal(frames.size, 1)
  assert.equal(runner.count(), DEFAULT_COUNT.confetti)
  let n = 0
  while (frames.size && n++ < 2000) frame()
  assert.equal(frames.size, 0, 'the loop stopped by itself')
  assert.equal(runner.count(), 0)
  assert.equal(runner.active(), false)
  assert.equal(state.idle, 1)
  assert.equal(drawn.at(-1), 0, 'the canvas was cleared on the way out')
  assert.ok(n > 30 && n < 1000, `ran for ${n} frames`)
})

test('firing again while running adds particles without starting a second loop, within the cap', () => {
  const { runner, frames, frame } = loop()
  runner.fire('confetti', { count: 200 })
  runner.fire('balloons', { count: 200 })
  assert.equal(frames.size, 1)
  assert.equal(runner.count(), 250)
  frame()
  assert.equal(frames.size, 1)
})

test('a long gap between frames is clamped so particles never teleport', () => {
  const { runner, frame } = loop()
  runner.fire('balloons', { count: 3 })
  frame(16)
  frame(5000)
  assert.equal(runner.count(), 3, 'nothing flew off after a 5 s stall')
})

test('pause (tab hidden) cancels the frame, clears everything, and refuses new effects until resumed', () => {
  const { runner, frames, drawn } = loop()
  runner.fire('confetti')
  runner.pause()
  assert.equal(frames.size, 0)
  assert.equal(runner.count(), 0)
  assert.equal(drawn.at(-1), 0)
  assert.equal(runner.fire('confetti'), false)
  assert.equal(frames.size, 0)
  runner.resume()
  assert.equal(runner.fire('confetti'), true)
  assert.equal(frames.size, 1)
})

test('destroy cancels the pending frame and nothing can be started afterwards', () => {
  const { runner, frames } = loop()
  runner.fire('fireworks')
  assert.equal(frames.size, 1)
  runner.destroy()
  assert.equal(frames.size, 0)
  assert.equal(runner.fire('confetti'), false)
  assert.equal(frames.size, 0)
  runner.destroy()
})

test('an unknown effect or a zero count starts nothing', () => {
  const { runner, frames } = loop()
  assert.equal(runner.fire('rain'), false)
  assert.equal(runner.fire('confetti', { count: 0 }), false)
  assert.equal(frames.size, 0)
})
