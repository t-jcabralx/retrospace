import { stripControl } from '../../../../../lib/ids.js'
import { requireOwner, boardRoute } from '../../../../../lib/access.js'
import { json, fail, parseBody } from '../../../../../lib/http.js'

export const runtime = 'nodejs'

const MAX_PEOPLE = 200
const isStr = (v) => typeof v === 'string'
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function birthday(v) {
  if (v === null || v === undefined) return { value: null }
  const m = isStr(v) && /^(\d\d)-(\d\d)$/.exec(v)
  if (!m) return { error: 'birthday must be MM-DD or null' }
  const mo = +m[1], d = +m[2]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS[mo - 1] ? { value: v } : { error: 'birthday is not a real date' }
}

function startDate(v) {
  if (v === null || v === undefined) return { value: null }
  const d = isStr(v) && /^\d{4}-\d\d-\d\d/.test(v) ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? { value: d } : { error: 'startDate must be an ISO date or null' }
}

function checkPeople(list) {
  if (!Array.isArray(list) || list.length > MAX_PEOPLE) return { error: `people must be an array of at most ${MAX_PEOPLE}` }
  const seen = new Set()
  const out = []
  for (const p of list) {
    if (p === null || typeof p !== 'object') return { error: 'invalid person' }
    if (!isStr(p.id) || !p.id || p.id.length > 40) return { error: 'person id must be 1..40 chars' }
    if (seen.has(p.id)) return { error: 'duplicate person id' }
    seen.add(p.id)
    const name = isStr(p.name) ? stripControl(p.name) : ''
    if (!name || name.length > 60) return { error: 'person name must be 1..60 chars' }
    const b = birthday(p.birthday)
    if (b.error) return b
    const s = startDate(p.startDate)
    if (s.error) return s
    out.push({ id: p.id, name, birthday: b.value, startDate: s.value })
  }
  return { value: out }
}

export const POST = boardRoute(async (req, { code, board, store }) => {
  await requireOwner(req, board)
  const [body, bad] = await parseBody(req, { max: 256 * 1024 })
  if (bad) return bad
  const r = checkPeople(body.people)
  if (r.error) return fail(400, r.error)
  return json({ people: await store.savePeople(code, r.value) })
}, { mutating: true })
