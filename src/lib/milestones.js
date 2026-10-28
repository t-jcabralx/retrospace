const MD = /^(\d{2})-(\d{2})$/
const pad = (n) => String(n).padStart(2, '0')
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

// Date-only values: ISO strings are read literally, Date objects by UTC parts (stored as UTC midnight).
function parseDay(v) {
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
    return m ? { y: +m[1], md: `${m[2]}-${m[3]}` } : null
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return { y: v.getUTCFullYear(), md: `${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}` }
  return null
}

export function todaysMilestones(people, now = new Date()) {
  const year = now.getFullYear()
  // Feb 29 celebrates on Feb 28 when this year has no Feb 29.
  const today = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const matches = (md) => (md === '02-29' && !isLeap(year) ? '02-28' : md) === today
  const out = []
  for (const p of Array.isArray(people) ? people : []) {
    if (typeof p?.birthday === 'string' && MD.test(p.birthday) && matches(p.birthday)) {
      out.push({ personId: p.id, name: p.name, kind: 'birthday' })
    }
    const start = parseDay(p?.startDate)
    if (start && matches(start.md) && year - start.y >= 1) {
      out.push({ personId: p.id, name: p.name, kind: 'anniversary', years: year - start.y })
    }
  }
  return out
}
