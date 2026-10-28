// Pure helpers for the shared board timer. The timer is stored as { endsAt, durationMs } where endsAt is on the SERVER's
// clock; every client works out `offset = serverNow - clientNow` and counts down to endsAt, so a client whose clock is
// minutes off still agrees with everyone else.
export const URGENT_MS = 10_000 // the last ten seconds
export const OVER_SHOW_MS = 30_000 // "Time's up" stays for this long after zero, then the timer hides

export const remainingMs = (timer, now, offset = 0) => timer.endsAt - (now + offset)

// mm:ss, rounded UP to a whole second (so 0:00 appears exactly when time is up) and never negative.
export function formatClock(ms) {
  const secs = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

// running | urgent (last 10 s) | over (0 until 30 s later) | gone
export function timerPhase(ms) {
  if (!Number.isFinite(ms)) return 'gone'
  if (ms > URGENT_MS) return 'running'
  if (ms > 0) return 'urgent'
  return ms > -OVER_SHOW_MS ? 'over' : 'gone'
}

// Screen readers hear the timer only at 1:00, 0:30, 0:10 and 0:00. -> 60 | 30 | 10 | 0, or null before 1:00.
export function announceBucket(ms) {
  if (ms <= 0) return 0
  if (ms <= 10_000) return 10
  if (ms <= 30_000) return 30
  if (ms <= 60_000) return 60
  return null
}
const SPOKEN = { 60: 'One minute left', 30: 'Thirty seconds left', 10: 'Ten seconds left', 0: 'Time is up' }
export const announcementText = (bucket) => SPOKEN[bucket] ?? ''

// offset (server minus client) from one round trip: the server stamped its reply about half way between our send and receive.
export const clockOffset = (serverNow, sentAt, receivedAt) => serverNow - (sentAt + receivedAt) / 2

const MAX_SAMPLES = 5
const MAX_RTT_MS = 10_000

// Follows the server clock from the `now` of snapshot and /since replies. The sample with the shortest round trip is the
// most trustworthy, so it wins among the last few; older ones age out so a drifting clock is followed.
export function createClock(nowFn = Date.now) {
  let samples = []
  let best = 0
  return {
    sample(serverNow, sentAt, receivedAt) {
      const rtt = receivedAt - sentAt
      if (![serverNow, sentAt, receivedAt].every(Number.isFinite) || rtt < 0 || rtt > MAX_RTT_MS) return
      samples = [...samples, { offset: clockOffset(serverNow, sentAt, receivedAt), rtt }].slice(-MAX_SAMPLES)
      best = samples.reduce((b, s) => (s.rtt <= b.rtt ? s : b)).offset
    },
    offset: () => best,
    now: () => nowFn() + best,
  }
}
