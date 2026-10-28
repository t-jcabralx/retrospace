// Pure helpers for the reveal-time field in the settings drawer. A datetime-local field has no zone, so it is read and
// written in the viewer's own zone, which the drawer names; the server stores the instant.
const pad = (n) => String(n).padStart(2, '0')

// ISO instant -> 'YYYY-MM-DDTHH:mm' in the local zone, or '' when there is none.
export function toLocalInput(iso) {
  const d = new Date(iso ?? NaN)
  if (iso == null || Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 'YYYY-MM-DDTHH:mm' (local) -> ISO instant, or null for an empty or unreadable value.
export function fromLocalInput(value) {
  const m = typeof value === 'string' ? value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/) : null
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const date = new Date(y, mo - 1, d, h, mi, 0, 0)
  return Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 ? null : date.toISOString()
}

const when = (d) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function describeReveal(iso, now = Date.now()) {
  const d = new Date(iso ?? NaN)
  if (iso == null || Number.isNaN(d.getTime())) return 'No reveal time is set: the recipient link opens the cards right away.'
  return d.getTime() > now ? `Reveals ${when(d)}` : `Revealed ${when(d)}`
}

// 'Asia/Manila (UTC+08:00)'
export function zoneLabel(at = new Date()) {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone'
  const mins = -at.getTimezoneOffset()
  const sign = mins < 0 ? '-' : '+'
  return `${name} (UTC${sign}${pad(Math.floor(Math.abs(mins) / 60))}:${pad(Math.abs(mins) % 60)})`
}
