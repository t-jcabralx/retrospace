// Pure helpers for the reveal countdown.
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H

// ms -> whole days/hours/minutes/seconds, rounded UP to the next second (0 shows only when the time has come); never negative.
export function countdownParts(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / S) : 0
  return { days: Math.floor(total / 86400), hours: Math.floor(total / 3600) % 24, minutes: Math.floor(total / 60) % 60, seconds: total % 60 }
}

export const pad2 = (n) => String(n).padStart(2, '0')

const MINUTE_STEPS = [30, 15, 10, 5, 2, 1]
const SECOND_STEPS = [30, 10, 5]

// What a screen reader is told, and when: the key changes hourly above an hour, then at 30/15/10/5/2/1 minutes, then at
// 30/10/5 seconds, then at zero. A live region that only changes with the key is quiet in between. -> { key, ms }
export function announceBucket(ms) {
  if (!(ms > 0)) return { key: 'now', ms: 0 }
  if (ms >= H) { const hours = Math.floor(ms / H); return { key: `h:${hours}`, hours } }
  if (ms >= M) { const minutes = MINUTE_STEPS.find((t) => ms >= t * M); return { key: `m:${minutes}`, minutes } }
  const seconds = SECOND_STEPS.find((t) => ms >= t * S) ?? 5
  return { key: `s:${seconds}`, seconds }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function announcementText(bucket) {
  if (bucket.key === 'now') return 'The wait is over'
  if (bucket.hours !== undefined) {
    const days = Math.floor(bucket.hours / 24)
    const hours = bucket.hours % 24
    const parts = [days && plural(days, 'day'), hours && plural(hours, 'hour')].filter(Boolean)
    return `${parts.join(' and ')} to go`
  }
  return `${bucket.minutes !== undefined ? plural(bucket.minutes, 'minute') : plural(bucket.seconds, 'second')} to go`
}

// The full time left as one sentence for a screen reader ("2 days 3 hours 10 minutes left"); zero units are left out and
// seconds only count when under a minute and nothing bigger is left.
export function countdownSentence(ms) {
  const p = countdownParts(ms)
  if (!p.days && !p.hours && !p.minutes && !p.seconds) return 'The wait is over'
  const parts = [p.days && plural(p.days, 'day'), p.hours && plural(p.hours, 'hour'), p.minutes && plural(p.minutes, 'minute'), (p.days || p.hours) ? 0 : p.seconds && plural(p.seconds, 'second')]
  return `${parts.filter(Boolean).join(' ')} left`
}

export { D as DAY_MS }
