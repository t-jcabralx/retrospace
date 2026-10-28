// Drives the particle list with animation frames, and only while there are particles: no particles, no frame
// requested. Everything it touches is injected (requestFrame, cancelFrame, draw, getBounds), so it is tested without a
// browser. The React side (Effects.jsx) supplies the real requestAnimationFrame and a canvas.
import { spawn, step, merge, DEFAULT_COUNT } from './effects-engine.js'

const MAX_FRAME_S = 0.05 // a stalled frame never advances the world by more than this

export function createRunner({ requestFrame, cancelFrame, getBounds, draw, onIdle = () => {}, rand = Math.random }) {
  let particles = []
  let raf = null
  let last = null
  let paused = false
  let dead = false

  function tick(now) {
    raf = null
    if (dead) return
    const dt = last === null ? 1 / 60 : Math.min(MAX_FRAME_S, Math.max(0, (now - last) / 1000))
    last = now
    particles = step(particles, dt, getBounds(), rand)
    draw(particles)
    if (particles.length) {
      raf = requestFrame(tick)
    } else {
      last = null
      onIdle()
    }
  }

  const halt = () => {
    if (raf !== null) cancelFrame(raf)
    raf = null
    last = null
    particles = []
  }

  return {
    // -> whether anything was started (false when paused, destroyed, an unknown effect or a zero count).
    fire(effect, { count = DEFAULT_COUNT[effect] } = {}) {
      if (dead || paused) return false
      const added = spawn(effect, count, getBounds(), rand)
      if (!added.length) return false
      particles = merge(particles, added)
      if (raf === null) raf = requestFrame(tick)
      return true
    },
    // The page is hidden: drop what is flying (it would be stale on return) and refuse new effects.
    pause() {
      paused = true
      halt()
      draw([])
    },
    resume() { paused = false },
    destroy() {
      dead = true
      halt()
    },
    active: () => raf !== null,
    count: () => particles.length,
  }
}
