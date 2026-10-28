// One self-rescheduling poll loop. Pure: timers are injected so tests can run it on a fake clock.
// `tick()` does one round and answers the delay (ms) before the next one, or null to stop for good. At most one round runs
// at a time and at most one timer is pending, however often `nudge()` is called (a tab becoming visible again, say): a
// nudge during a round is dropped, since that round schedules its successor itself.
export function createPoller({ tick, timers = { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) }, hidden = () => false, hiddenMinMs = 0 }) {
  let timer = null
  let running = false
  let dead = false

  const schedule = (ms) => {
    if (timer !== null) timers.clearTimeout(timer)
    timer = timers.setTimeout(run, ms)
  }

  async function run() {
    timer = null
    if (dead || running) return
    running = true
    let next = null
    try {
      next = await tick()
    } catch {
      next = null
    } finally {
      running = false
    }
    if (dead || next == null) return
    schedule(hidden() ? Math.max(next, hiddenMinMs) : next)
  }

  return {
    start: run,
    nudge() { if (!dead && !running) schedule(0) },
    stop() {
      dead = true
      if (timer !== null) timers.clearTimeout(timer)
      timer = null
    },
  }
}
