import { THROW_BURST, THROW_WINDOW_MS } from '../lib/throwConfig.js'

// Pure maths for thrown emoji: no DOM, no timers. Positions are screen pixels (y grows downward).
export const FLIGHT_MS = 650
export const MAX_FLYING = 12 // animations alive at once; extras are dropped
export const ANNOUNCE_GAP_MS = 2000 // spoken at most this often, across all senders

const TAU = Math.PI * 2
const MAX_LIFT = 180
const clamp01 = (t) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0)
const easeOut = (u) => 1 - (1 - u) * (1 - u)

// Where the emoji is at progress t (0..1) on its way from `from` to `to`: a parabolic arc that rises above the straight line.
export function arcPosition(from, to, t) {
  const u = clamp01(t)
  if (u === 0) return { x: from.x, y: from.y }
  if (u === 1) return { x: to.x, y: to.y }
  const e = easeOut(u)
  const lift = Math.min(MAX_LIFT, 30 + 0.3 * Math.hypot(to.x - from.x, to.y - from.y))
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - lift * 4 * u * (1 - u) }
}

// Rotation in degrees: two full turns that slow down, so the emoji lands upright.
export const spinAt = (t) => (1 - (1 - clamp01(t)) ** 3) * 720

// The sparks of the impact pop, fanned around the target: [{ dx, dy, size, delay }] in pixels and seconds.
export function impactParticles(rand = Math.random) {
  const n = 8
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU + (rand() - 0.5) * 0.5
    const d = 40 + rand() * 40
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, size: 3 + rand() * 4, delay: rand() * 0.06 }
  })
}

// The sender's own throttle, to match the server's 3 per 4.5 s: counted over a sliding window, which can never exceed
// the server's fixed window. Refused tries are not recorded.
export function createThrowLimiter({ max = THROW_BURST, windowMs = THROW_WINDOW_MS, now = Date.now } = {}) {
  let stamps = []
  const fresh = () => { const t = now(); stamps = stamps.filter((s) => s > t - windowMs); return t }
  return {
    tryThrow() {
      const t = fresh()
      if (stamps.length >= max) return false
      stamps.push(t)
      return true
    },
    waitMs() {
      const t = fresh()
      return stamps.length < max ? 0 : stamps[0] + windowMs - t
    },
  }
}

// Lets one call through per `gapMs`.
export function createGate(gapMs, now = Date.now) {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < gapMs) return false
    last = t
    return true
  }
}
