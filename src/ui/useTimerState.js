'use client'
// The shared timer as this client sees it: the stored { endsAt, durationMs }, the milliseconds left on the SERVER's clock
// (ctl.clock keeps the offset) and the phase. Re-renders four times a second, only while there is something to show.
import { useEffect, useState } from 'react'
import { remainingMs, timerPhase } from './timer.js'

const TICK_MS = 250
const num = (n) => typeof n === 'number' && Number.isFinite(n)
export const validTimer = (t) => (t && num(t.endsAt) && num(t.durationMs) ? t : null)

export function useTimerState(ctl) {
  const timer = validTimer(ctl.board?.timer)
  const [, tick] = useState(0)
  const ms = timer ? remainingMs(timer, Date.now(), ctl.clock.offset()) : NaN
  const phase = timer ? timerPhase(ms) : 'gone'
  const live = phase !== 'gone'
  useEffect(() => {
    if (!live) return undefined
    const id = setInterval(() => tick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [live, timer?.endsAt])
  return { timer, ms, phase }
}
