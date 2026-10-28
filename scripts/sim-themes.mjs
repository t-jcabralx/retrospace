// Black-box simulation of AI theme grouping on a retro board and the print view's data.
// Usage: node scripts/sim-themes.mjs [baseUrl]  (default http://localhost:3300)
// Start a FRESH server first with blanked services and AI_FAKE=1 (rate-limit counters live in the server process).
// Exits non-zero on the first failure. No real AI call is made.
import { randomBytes } from 'node:crypto'

const BASE = (process.argv[2] || 'http://localhost:3300').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }

class Jar {
  constructor() { this.m = new Map() }
  absorb(list) {
    for (const c of list) {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim())
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (!value || attrs.includes('Max-Age=0')) this.m.delete(name)
      else this.m.set(name, value)
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
}

const bodies = []
async function call(method, path, body, jar) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await res.text()
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  jar?.absorb(res.headers.getSetCookie())
  return { status: res.status, data, text }
}

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

const owner = new Jar()
const reg = await call('POST', '/api/auth/register', { email: `dana-${rnd()}@example.com`, name: 'Dana', password: 'correct horse battery' }, owner)
if (reg.status !== 200) { console.log('FAIL could not register', reg.status, reg.data); process.exit(1) }
const code = (await call('POST', '/api/boards', { type: 'retro', template: 'retro-ssc', title: 'Themes sim' }, owner)).data.code
const guest = new Jar()
await call('GET', `/api/boards/${code}`, undefined, guest)
await call('PUT', `/api/boards/${code}/persona`, { persona: { kind: 'custom', name: 'Gus', avatar: AV } }, guest)
const note = (id, text, x) => ({ op: 'add', item: { id, kind: 'note', x, y: 120, w: 200, h: 160, data: { text } } })
check('notes can be added', (await call('POST', `/api/boards/${code}/ops`, { ops: [note('n-a', 'SIM-NOTE-ALPHA', 40), note('n-b', 'SIM-NOTE-BETA', 300), note('n-c', 'SIM-NOTE-GAMMA', 560)] }, guest)).status === 200)

const T = `/api/boards/${code}/themes`
check('a guest cannot read or ask for themes', (await call('GET', T, undefined, guest)).status === 401 && (await call('POST', T, {}, guest)).status === 401)
check('AI off: the owner is told so', (await call('POST', T, {}, owner)).status === 403)
check('the owner turns AI on', (await call('PATCH', `/api/boards/${code}`, { ai: { enabled: true, ack: true } }, owner)).status === 200)
const made = await call('POST', T, {}, owner)
check('the owner gets suggestions', made.status === 200 && Array.isArray(made.data.suggestions?.themes) && made.data.suggestions.themes.length > 0, made.data)
const list = made.data.suggestions.themes
check('suggestions use stored note ids that exist', list.every((t) => t.noteIds.every((id) => ['n-a', 'n-b', 'n-c'].includes(id))), list)
const mark = list[0].title
check('the owner reads them back', JSON.stringify((await call('GET', T, undefined, owner)).data).includes(mark))

// owner-only: no guest transport carries them
const views = [
  await call('GET', `/api/boards/${code}`, undefined, guest),
  await call('GET', `/api/boards/${code}/since?t=0`, undefined, guest),
  await call('GET', `/api/boards/${code}`, undefined, owner),
]
check('no board view (guest or owner) carries the suggestions', views.every((v) => v.status === 200 && !v.text.includes('themeSuggestions') && !v.text.includes(mark)), views.map((v) => v.status))

// accept: a theme item through the normal ops path
const theme = { op: 'add', item: { id: 'th-1', kind: 'theme', x: 40, y: 400, w: 260, h: 140, data: { title: 'Sim theme', noteIds: list[0].noteIds.slice(0, 50) } } }
check('accepting adds a theme item', (await call('POST', `/api/boards/${code}/ops`, { ops: [theme] }, owner)).status === 200)
check('a theme with 51 note ids is refused', (await call('POST', `/api/boards/${code}/ops`, { ops: [{ ...theme, item: { ...theme.item, id: 'th-2', data: { title: 'x', noteIds: Array.from({ length: 51 }, (_, i) => `i${i}`) } } }] }, owner)).status === 400)
check('the owner opens voting', (await call('PATCH', `/api/boards/${code}`, { vote: { active: true, perPerson: 3 } }, owner)).status === 200)
check('a guest can vote on the theme', (await call('POST', `/api/boards/${code}/ops`, { ops: [{ op: 'vote', id: 'th-1' }] }, guest)).status === 200)

// print view: the same snapshot rules as the board
const snap = await call('GET', `/api/boards/${code}`, undefined, guest)
check('the print source has the theme and the notes', snap.data.items.some((i) => i.kind === 'theme') && snap.data.items.some((i) => i.id === 'n-a'))
check('the print page is served for a valid code, not for a malformed one', (await fetch(`${BASE}/b/${code}/print`)).status === 200 && (await fetch(`${BASE}/b/no/print`)).status === 404)
console.log(`\nall ${n} checks passed`)
