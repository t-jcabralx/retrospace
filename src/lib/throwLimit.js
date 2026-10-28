// Server-only: the rate limit on thrown emoji. A token bucket is not possible with the fixed-window counters every
// other limiter here shares (Redis INCR, or the in-process fallback), so the budget is one window: 3 throws per 4.5 s
// per participant. That is a sustained rate of 1 per 1.5 s with a burst of 3, and it holds across servers. A window
// that opens in the middle of someone's burst can let up to 6 through in 4.5 s at the very worst. The client counts
// the same budget over a sliding 4.5 s, which never exceeds it in any window.
import { windowHit, windowRefund, retryAfterSecs } from './http.js'
import { THROW_WINDOW_MS, THROW_BURST } from './throwConfig.js'

export { THROW_WINDOW_MS, THROW_BURST }

// -> 0 when the throw may go ahead (and is counted), else the seconds to wait. A refused try is given back, so
// hammering the button costs nothing and cannot extend the wait.
export async function throwWait(id) {
  const key = `throw:${id}`
  if ((await windowHit(key, THROW_WINDOW_MS, { localFallback: true })) <= THROW_BURST) return 0
  await windowRefund(key, THROW_WINDOW_MS)
  return retryAfterSecs(THROW_WINDOW_MS)
}
