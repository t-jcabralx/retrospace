// Black-box simulation of the team wall. Usage: node scripts/sim-wall.mjs [baseUrl]  (default http://localhost:3000)
// Start a FRESH dev/production server first (blanked env): rate-limit counters live in the server process.
// Exits non-zero on the first failed assertion.
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const pad = (n) => String(n).padStart(2, '0')

class Jar {
  constructor() { this.m = new Map() }
  absorb(list) {
    for (const c of list) {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim())
      const eq = pair.indexOf('=')
      const [name, value] = [pair.slice(0, eq), pair.slice(eq + 1)]
      if (!value || attrs.includes('Max-Age=0')) this.m.delete(name)
      else this.m.set(name, value)
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function call(method, path, body, jar) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
  jar?.absorb(res.headers.getSetCookie())
  return { status: res.status, data, res }
}

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

async function roomInMinute(needMs = 10_000) {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100))
}

const owner = new Jar()
const reg = await call('POST', '/api/auth/register', { email: `wall-${rnd()}@example.com`, name: 'Wanda', password: 'correct horse battery' }, owner)
check('owner registers', reg.status === 200, reg)
const made = await call('POST', '/api/boards', { type: 'wall', template: 'team', title: 'Team wall' }, owner)
check('wall created with the team template', made.status === 200 && /^[2-9A-HJKMNP-Z]{6}$/.test(made.data.code), made)
const code = made.data.code
const so = (id, over = {}) => ({ op: 'add', item: { id, kind: 'shoutout', x: 0, y: 0, w: 320, h: 280, data: { toName: 'Ana', message: 'Great job', badge: 'Teamwork', at: Date.now(), ...over } } })
const ops = (jar, list) => call('POST', `/api/boards/${code}/ops`, { ops: list }, jar)
async function browser() {
  const jar = new Jar()
  const snap = await call('GET', `/api/boards/${code}`, undefined, jar)
  const put = await call('PUT', `/api/boards/${code}/persona`, { persona: generatePersona() }, jar)
  check('a guest browser joins and chooses a persona', snap.status === 200 && put.status === 200, [snap.status, put.status])
  return jar
}

const now = new Date()
const md = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const today = `${now.getFullYear()}-${md}`
const people = [
  { id: 'p1', name: 'Ana', birthday: md, startDate: null },
  { id: 'p2', name: 'Bo', birthday: null, startDate: `${now.getFullYear() - 3}-${md}` },
  { id: 'p3', name: 'Cy', birthday: '01-01', startDate: '2019-01-01' },
]
const g1 = await browser()
const g2 = await browser()
const denied = await call('POST', `/api/boards/${code}/people`, { people }, g1)
check('a guest cannot save the people list', denied.status === 401 || denied.status === 403, denied)
const saved = await call('POST', `/api/boards/${code}/people`, { people }, owner)
check('the owner saves three people', saved.status === 200, saved)

const snapG = await call('GET', `/api/boards/${code}`, undefined, g1)
check('the guest snapshot carries no people (no birthdays or start dates)', Array.isArray(snapG.data.people) && snapG.data.people.length === 0 && !JSON.stringify(snapG.data).includes(md), snapG.data.people)
const names = await call('GET', `/api/boards/${code}/people-names`, undefined, g1)
check('people-names gives id and name only', names.status === 200 && JSON.stringify(names.data) === JSON.stringify([{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }, { id: 'p3', name: 'Cy' }]), names.data)
const ms = await call('GET', `/api/boards/${code}/milestones?today=${today}`, undefined, g1)
check("today's milestones: a birthday and a 3-year anniversary, no raw dates", ms.status === 200 && JSON.stringify(ms.data) === JSON.stringify([{ personId: 'p1', name: 'Ana', kind: 'birthday' }, { personId: 'p2', name: 'Bo', kind: 'anniversary', years: 3 }]), ms.data)
check('milestones refuse a malformed or far-away day', (await call('GET', `/api/boards/${code}/milestones?today=2026-02-30`, undefined, g1)).status === 400 && (await call('GET', `/api/boards/${code}/milestones?today=2001-01-01`, undefined, g1)).status === 400)

await roomInMinute()
const first = await ops(g1, Array.from({ length: 10 }, (_, i) => so(`s${i}`, { message: `Shout ${i}` })))
check('a guest posts ten shout-outs', first.status === 200 && first.data.applied.length === 10, first.data)
const eleventh = await ops(g1, [so('s10')])
check('the 11th in a minute is refused: Slow down', eleventh.data.applied.length === 0 && eleventh.data.rejected[0]?.error === 'Slow down', eleventh.data)
check('another participant has their own budget', (await ops(g2, [so('g2a', { toName: 'Bo', to: 'p2' })])).data.applied.length === 1)
check('a bad badge and an http gif are refused', (await ops(g2, [so('b1', { badge: 'Nope' }), so('b2', { gif: 'http://x.example/a.gif' })])).data.rejected.length === 2)
const react = await ops(g2, [{ op: 'react', id: 's0', emoji: '🎉' }])
check('a reaction toggles on', react.data.applied[0]?.reactions?.['🎉']?.length === 1, react.data)
check('a guest cannot delete another guest\'s shout-out', (await ops(g2, [{ op: 'delete', id: 's0' }])).data.rejected[0]?.error === 'Not allowed')
check('the owner can delete any shout-out', (await ops(owner, [{ op: 'delete', id: 's0' }])).data.applied.length === 1)
console.log(`\n${n} checks passed`)
