// Pure rules of the team wall, shared by the routes and the UI (browser-safe, no imports beyond milestones.js).
import { todaysMilestones } from './milestones.js'

export const SHOUTOUT_PER_MINUTE = 10
export const SHOUTOUT_WINDOW_MS = 60_000
export const FEED_PAGE = 30
export const MAX_MENTIONS = 8
export const MAX_SHOUT_MESSAGE = 500
export const MAX_TO_NAME = 60

const pad = (n) => String(n).padStart(2, '0')
const DAY_MS = 86_400_000

// Birthdays and start dates never leave the server for a guest: they get the names to @mention and nothing else.
export const guestPeople = (people) => (Array.isArray(people) ? people : []).map((p) => ({ id: p.id, name: p.name }))

// The viewer's local calendar day as YYYY-MM-DD.
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Validates ?today=YYYY-MM-DD: a real date, and within a day of the server's UTC date (every time zone is within that).
// The window is what stops a guest from stepping through the whole year to read everyone's birthday.
export function parseToday(raw, now = Date.now()) {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null
  if (!m) return { ok: false, error: 'today must be YYYY-MM-DD' }
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return { ok: false, error: 'today is not a real date' }
  if (Math.abs(Math.floor(t / DAY_MS) - Math.floor(now / DAY_MS)) > 1) return { ok: false, error: 'today is out of range' }
  return { ok: true, value: raw, year: y, month: mo, day: d }
}

// -> [{ personId, name, kind, years? }] for the given calendar day; the only thing a guest learns of the people list.
export function milestonesOn(people, parsed) {
  return todaysMilestones(people, new Date(parsed.year, parsed.month - 1, parsed.day))
    .map(({ personId, name, kind, years }) => ({ personId, name, kind, ...(years !== undefined && { years }) }))
}

const stamp = (i) => (typeof i.data?.at === 'number' ? i.data.at : 0)

// Live shout-outs, newest first (the composer stamps data.at; z, then id, keep the order stable for the rest).
export function feedItems(items) {
  return [...items]
    .filter((i) => i.kind === 'shoutout' && !i.deleted)
    .sort((a, b) => stamp(b) - stamp(a) || (b.z ?? 0) - (a.z ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

// -> { visible, hasMore, next }: `shown` items from the top and the count to ask for when "Load more" is pressed.
export function feedPage(sorted, shown = FEED_PAGE) {
  const n = Math.max(FEED_PAGE, shown)
  return { visible: sorted.slice(0, n), hasMore: sorted.length > n, next: n + FEED_PAGE }
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// @mention autocomplete: names starting with the query first, then names containing it; case and accents ignored.
export function matchPeople(people, query, max = MAX_MENTIONS) {
  const q = fold(String(query ?? '').replace(/^@/, ''))
  const list = Array.isArray(people) ? people : []
  const starts = []
  const has = []
  for (const p of list) {
    const n = fold(p.name)
    if (!q || n.startsWith(q)) starts.push(p)
    else if (n.includes(q)) has.push(p)
  }
  const byName = (a, b) => fold(a.name).localeCompare(fold(b.name))
  return [...starts.sort(byName), ...has.sort(byName)].slice(0, max)
}

// The shout-out the composer posts. Placed on the canvas in a three-column grid, newest after the last.
export function buildShoutoutData({ toName, to, message, badge, gif }, now = Date.now()) {
  return { toName: toName.trim(), message: message.trim(), badge, at: now, ...(to && { to }), ...(gif && { gif }) }
}

// -> { toName?, message? } with friendly texts; empty when fine.
export function checkShoutout({ toName, message }) {
  const errors = {}
  if (!String(toName ?? '').trim()) errors.toName = 'Who is this shout-out for?'
  else if (String(toName).trim().length > MAX_TO_NAME) errors.toName = `Names can be up to ${MAX_TO_NAME} characters`
  if (!String(message ?? '').trim()) errors.message = 'Write your shout-out'
  else if (String(message).length > MAX_SHOUT_MESSAGE) errors.message = `Shout-outs can be up to ${MAX_SHOUT_MESSAGE} characters (now ${String(message).length})`
  return errors
}

export const shoutoutSlot = (count) => ({ x: (count % 3) * 340, y: Math.floor(count / 3) * 300, w: 320, h: 280 })

// --- the birthday / anniversary banner: shown once per day per board per browser --------------------------------
export const milestoneKey = (code, day) => `km:ms:${code}:${day}`

export function bannerSeen(storage, code, day) {
  try { return (storage?.getItem(milestoneKey(code, day)) ?? null) !== null } catch { return false }
}
export function markBannerSeen(storage, code, day) {
  try { storage?.setItem(milestoneKey(code, day), '1') } catch { /* private mode: the banner may show again */ }
}

export const bannerEffects = (ms) => [ms.some((m) => m.kind === 'birthday') && 'balloons', ms.some((m) => m.kind === 'anniversary') && 'fireworks'].filter(Boolean)

export function bannerLines(ms) {
  return ms.map((m) => (m.kind === 'birthday' ? `Happy birthday, ${m.name}!` : `${m.name}: ${m.years} ${m.years === 1 ? 'year' : 'years'} at the team today!`))
}

// The Feed/Canvas choice, remembered per board.
export const viewKey = (code) => `km:wallview:${code}`
export function readView(storage, code) {
  try { return storage?.getItem(viewKey(code)) === 'canvas' ? 'canvas' : 'feed' } catch { return 'feed' }
}
export function writeView(storage, code, view) {
  try { storage?.setItem(viewKey(code), view) } catch { /* not remembered */ }
}

// --- the owner's people editor ---------------------------------------------------------------------------------
export const MAX_PEOPLE = 200
const MD_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// Stored people -> editor rows (strings only; a stored start date is an ISO string, its day part is kept).
export const toRows = (people) =>
  (Array.isArray(people) ? people : []).map((p) => ({ id: p.id, name: p.name ?? '', birthday: p.birthday ?? '', startDate: typeof p.startDate === 'string' ? p.startDate.slice(0, 10) : '' }))

// -> a friendly problem for a row, or ''.
export function rowProblem(r) {
  if (!r.name.trim()) return 'Give this person a name'
  if (r.name.trim().length > MAX_TO_NAME) return `Names can be up to ${MAX_TO_NAME} characters`
  if (r.birthday) {
    const m = /^(\d\d)-(\d\d)$/.exec(r.birthday.trim())
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > MD_DAYS[+m[1] - 1]) return 'Birthday must be a real month and day, like 03-14'
  }
  if (r.startDate && (!/^\d{4}-\d\d-\d\d$/.test(r.startDate) || Number.isNaN(new Date(r.startDate).getTime()))) return 'Start date must be a real date'
  return ''
}

export const rowsToPayload = (rows) => rows.map((r) => ({ id: r.id, name: r.name.trim(), birthday: r.birthday.trim() || null, startDate: r.startDate || null }))
