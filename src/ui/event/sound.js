// Optional sound for the wheel: a tick as a slice passes the pointer and a short fanfare for a win. Off until someone turns
// it on (browsers only allow sound after a tap, and a room should not be surprised). Nothing is downloaded: the sounds are
// made with the Web Audio API. Every call is safe when audio is missing or blocked.
const KEY = 'ev_sound'

export const soundWanted = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export const rememberSound = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ } }

let ctx = null
function audio() {
  try {
    ctx ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch { return null }
}

function blip(freq, at, dur, { type = 'triangle', gain = 0.06 } = {}) {
  const c = audio()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, c.currentTime + at)
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur)
  o.connect(g).connect(c.destination)
  o.start(c.currentTime + at)
  o.stop(c.currentTime + at + dur + 0.02)
}

export const tick = () => blip(1250, 0, 0.04, { type: 'square', gain: 0.025 })
export const unlock = () => { audio() }
export function win() { [523, 659, 784, 1047].forEach((f, i) => blip(f, i * 0.12, 0.28, { gain: 0.07 })) }
