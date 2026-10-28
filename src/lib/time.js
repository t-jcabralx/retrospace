// "3 min ago" style times for the dashboard. Pure; `now` is injectable for tests.
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Older than a week: a short date in the viewer's own time zone (`timeZone` is only for tests).
export function relativeTime(when, now = Date.now(), timeZone) {
  const t = typeof when === 'number' ? when : Date.parse(when)
  if (!Number.isFinite(t)) return ''
  const diff = now - t
  if (diff < MIN) return 'just now' // also covers clock skew (a time slightly in the future)
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  }
  const days = Math.floor(diff / DAY)
  if (days < 2) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const year = (ms) => new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(ms)
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year(t) === year(now) ? {} : { year: 'numeric' }), timeZone })
}
