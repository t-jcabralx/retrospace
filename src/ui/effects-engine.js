// Celebration particles: pure maths, no DOM, no timers. `spawn` makes particles, `step` moves them by `dt` seconds, and
// both take their randomness as an argument so a run is reproducible. Units are CSS pixels and seconds; y grows
// downward. The same list is drawn by effects-draw.js and driven by effects-runner.js.
//
// particle = { kind, x, y, vx, vy, size, rot, vr, color, age, ttl, drag, gravity, wind, phase, delay?, fuse? }
//   kind: 'confetti' | 'balloon' | 'rocket' | 'spark'
export const EFFECTS = ['confetti', 'balloons', 'fireworks']
export const MAX_PARTICLES = 250 // hard cap on what is alive at once, whatever is fired
export const DEFAULT_COUNT = { confetti: 120, balloons: 14, fireworks: 5 }

const COLORS = ['#ff5d73', '#ffb703', '#ffd166', '#06d6a0', '#4cc9f0', '#7b6cf6', '#f78fb3', '#ff8c42']
const BURST = 30 // sparks per firework
const MARGIN = 60 // how far past a side a particle may fly before it is dropped

const TAU = Math.PI * 2
const between = (rand, lo, hi) => lo + rand() * (hi - lo)
const pick = (rand, list) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
const safe = (n) => (Number.isFinite(n) ? n : 0)

function confetti(rand, { w, h }, i) {
  // Two party poppers in the bottom corners, firing up and in; the pieces tumble back down.
  const left = i % 2 === 0
  const a = (left ? between(rand, -80, -45) : between(rand, -135, -100)) * (Math.PI / 180)
  const speed = between(rand, 500, 1250)
  return {
    kind: 'confetti', x: left ? w * between(rand, 0.02, 0.1) : w * between(rand, 0.9, 0.98), y: h * between(rand, 0.9, 1),
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: between(rand, 6, 12), rot: between(rand, 0, TAU), vr: between(rand, -9, 9),
    color: pick(rand, COLORS), age: 0, ttl: between(rand, 3, 5), drag: between(rand, 2, 3), gravity: between(rand, 260, 380),
    wind: between(rand, 20, 60), phase: between(rand, 0, TAU),
  }
}

function balloon(rand, { w, h }) {
  return {
    kind: 'balloon', x: w * between(rand, 0.05, 0.95), y: h * between(rand, 0.92, 1), vx: 0, vy: -between(rand, 90, 170),
    size: between(rand, 24, 40), rot: 0, vr: 0, color: pick(rand, COLORS), age: 0, ttl: 14, drag: 0.15, gravity: -8,
    wind: between(rand, 25, 60), phase: between(rand, 0, TAU), delay: between(rand, 0, 1.2),
  }
}

function rocket(rand, { w, h }, i) {
  const fuse = between(rand, 0.7, 1.2)
  const climb = h * between(rand, 0.35, 0.7) // how far up it bursts
  return {
    kind: 'rocket', x: w * between(rand, 0.15, 0.85), y: h, vx: 0, vy: -climb / fuse, size: 3, rot: 0, vr: 0,
    color: pick(rand, COLORS), age: 0, ttl: fuse + 0.5, drag: 0, gravity: 0, wind: 0, phase: 0, fuse, delay: i * 0.45 + between(rand, 0, 0.25),
  }
}

const MAKE = { confetti, balloons: balloon, fireworks: rocket }

// -> `count` new particles for `effect` (0 for an unknown effect), all starting inside `bounds` = { w, h }.
export function spawn(effect, count, bounds, rand = Math.random) {
  const make = Object.hasOwn(MAKE, effect) ? MAKE[effect] : null
  const n = make ? Math.max(0, Math.min(MAX_PARTICLES, Math.floor(safe(count)))) : 0
  return Array.from({ length: n }, (_, i) => make(rand, bounds, i))
}

// Adds new particles to the live ones; when over the cap the oldest go.
export const merge = (live, added) => {
  const all = [...live, ...added]
  return all.length > MAX_PARTICLES ? all.slice(all.length - MAX_PARTICLES) : all
}

function burst(rocket, rand) {
  const turn = between(rand, 0, TAU / BURST)
  return Array.from({ length: BURST }, (_, k) => {
    const a = turn + (k / BURST) * TAU
    const speed = (k % 2 ? 0.55 : 1) * between(rand, 170, 300)
    return {
      kind: 'spark', x: rocket.x, y: rocket.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: between(rand, 2, 3.4), rot: 0, vr: 0,
      color: rocket.color, age: 0, ttl: between(rand, 0.9, 1.5), drag: 1.3, gravity: 170, wind: 0, phase: 0,
    }
  })
}

const gone = (p, { w, h }) => {
  if (p.age >= p.ttl) return true
  if (p.x < -MARGIN || p.x > w + MARGIN) return true
  if (p.kind === 'balloon') return p.y < -(p.size * 3 + 20)
  return p.y > h + p.size + MARGIN // confetti and sparks fall away below; going above the top is fine, they come back
}

// Moves every particle forward by `dt` seconds -> the survivors (plus the sparks of any rocket that burst). `bounds`
// = { w, h } decides what counts as off screen; `rand` is only used for bursts. Never changes its input.
export function step(particles, dt, bounds, rand = Math.random) {
  if (!(dt > 0)) return particles
  const out = []
  for (const p of particles) {
    if (p.delay > 0) { out.push({ ...p, delay: p.delay - dt }); continue } // waiting for its turn
    const age = p.age + dt
    if (age >= p.ttl) continue
    if (p.kind === 'rocket' && age >= p.fuse) {
      const x = p.x + p.vx * (p.fuse - p.age)
      const y = p.y + p.vy * (p.fuse - p.age)
      out.push(...burst({ ...p, x, y }, rand))
      continue
    }
    const k = Math.exp(-p.drag * dt)
    const vx = (p.vx + Math.sin(age * 3 + p.phase) * p.wind * dt * 4) * k
    const vy = (p.vy + p.gravity * dt) * k
    const next = { ...p, age, vx, vy, x: p.x + vx * dt, y: p.y + vy * dt, rot: p.rot + p.vr * dt }
    if (!gone(next, bounds)) out.push(next)
  }
  return out.length > MAX_PARTICLES ? out.slice(out.length - MAX_PARTICLES) : out
}
