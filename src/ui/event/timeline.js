// Where each ring of the wheel is at a given server time, and what may be shown yet. Pure, so it is unit tested; every
// client computes the same thing from the stored spin record, which is what keeps all screens in step.
import { spinAngle, ringPrizes, ringPeople } from '../../lib/wheel.js'

const easeOut = (p) => 1 - (1 - p) ** 5 // a long, gentle slowing down

// -> { phase: 'waiting' | 'spinning' | 'done', angle } for one spin record. `reduced` skips the motion.
export function spinAt(spin, now, reduced = false) {
  const target = spinAngle(spin.index, spin.count)
  if (reduced || now >= spin.startAt + spin.durationMs) return { phase: 'done', angle: target }
  if (now < spin.startAt) return { phase: 'waiting', angle: 0 }
  return { phase: 'spinning', angle: target * easeOut((now - spin.startAt) / spin.durationMs) }
}

// The whole picture for one moment: ring angles, which step is turning, and which results may be shown.
// -> { outer, inner, turning: 'prize' | 'winner' | null, prize, winner, prizeShown, winnerShown }
//    prize / winner are the chosen items (or null); *Shown is false until that ring has finished turning.
export function view(wheel, now, reduced = false) {
  const { round } = wheel
  const prize = round.prizeId ? wheel.prizes.find((z) => z.id === round.prizeId) ?? null : null
  const winner = round.winnerId ? wheel.participants.find((p) => p.id === round.winnerId) ?? null : null
  const out = { outer: 0, inner: 0, turning: null, prize, winner, prizeShown: false, winnerShown: false }
  if (round.state === 'idle') return out

  const spin = round.spin
  const prizeIndex = prize ? ringPrizes(wheel).findIndex((z) => z.id === prize.id) : -1
  const restInner = prizeIndex >= 0 ? spinAngle(prizeIndex, ringPrizes(wheel).length) : 0

  if (spin?.step === 'prize') {
    const s = spinAt(spin, now, reduced)
    return { ...out, inner: s.angle, turning: s.phase === 'done' ? null : 'prize', prizeShown: s.phase === 'done' }
  }
  if (spin?.step === 'winner') {
    const s = spinAt(spin, now, reduced)
    return { ...out, inner: restInner, outer: s.angle, turning: s.phase === 'done' ? null : 'winner', prizeShown: true, winnerShown: s.phase === 'done' }
  }
  // after "skip" or "back" there is no spin record: the prize sits under the pointer, the winner is not chosen
  return { ...out, inner: restInner, prizeShown: Boolean(prize) }
}

// The eligible ring lists the view is drawn from (the same ones the server picked from).
export const rings = (wheel) => ({ people: ringPeople(wheel), prizes: ringPrizes(wheel) })

// Milliseconds until the current spin is over (0 when nothing is turning), for scheduling the next frame or announcement.
export const msLeft = (wheel, now) => {
  const s = wheel.round.spin
  return s ? Math.max(0, s.startAt + s.durationMs - now) : 0
}
