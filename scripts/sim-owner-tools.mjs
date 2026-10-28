// Black-box simulation of the owner's tools: removing a participant (ban, kept or deleted notes) and the CSV export.
// Usage: node scripts/sim-owner-tools.mjs [baseUrl]  (default http://localhost:3000)
// Start a FRESH server first (blanked env): rate-limit counters live in the server process. Exits non-zero on the first failure.
import { randomBytes } from 'node:crypto'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }

class Jar {
  constructor() { this.m = new Map() }
  absorb(setCookies) {
    for (const c of setCookies) {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim())
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (!value || attrs.includes('Max-Age=0')) this.m.delete(name)
      else this.m.set(name, value)
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
  get(name) { return this.m.get(name) }
}

const rawUids = new Set() // private cookie uids; none may appear in any body
const bodies = []
async function call(method, path, body, { jar } = {}) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  const setCookies = res.headers.getSetCookie()
  for (const c of setCookies) if (c.startsWith('rs_g=')) rawUids.add(c.slice(5).split(';')[0].split('.')[0])
  jar?.absorb(setCookies)
  return { status: res.status, data, text, headers: res.headers }
}

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

async function account(name) {
  const jar = new Jar()
  const r = await call('POST', '/api/auth/register', { email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' }, { jar })
  if (r.status !== 200) { console.log('FAIL could not register', name, r.status, r.data); process.exit(1) }
  return jar
}
async function guest(code, name) {
  const jar = new Jar()
  const snap = await call('GET', `/api/boards/${code}`, undefined, { jar })
  const put = await call('PUT', `/api/boards/${code}/persona`, { persona: { kind: 'custom', name, avatar: AV } }, { jar })
  if (put.status !== 200) { console.log('FAIL persona', put.status, put.data); process.exit(1) }
  return { jar, uid: snap.data.viewer.uid }
}
const note = (id, text) => ({ op: 'add', item: { id, kind: 'note', x: 10, y: 20, w: 200, h: 200, data: { text } } })
const ops = (code, jar, list) => call('POST', `/api/boards/${code}/ops`, { ops: list }, { jar })
const kick = (code, id, jar, q = '') => call('DELETE', `/api/boards/${code}/participants/${id}${q}`, undefined, { jar })

const owner = await account('Dana')
const code = (await call('POST', '/api/boards', { type: 'workshop', template: 'blank', title: 'Owner tools sim' }, { jar: owner })).data.code
const gus = await guest(code, 'Gus')
const vic = await guest(code, 'Vic')
const wil = await guest(code, 'Wil')
check('guests can post', (await ops(code, gus.jar, [note('g1', 'from gus'), note('g2', '=cmd|calc')])).status === 200)
check('another guest posts', (await ops(code, vic.jar, [note('v1', 'from vic')])).status === 200)

// --- removal ---
check('a guest cannot remove anybody', (await kick(code, vic.uid, gus.jar)).status === 401)
const mine = (await call('GET', `/api/boards/${code}`, undefined, { jar: owner })).data.viewer.uid
check('the owner cannot remove themselves', (await kick(code, mine, owner)).status === 400)
check('a malformed id is 400', (await kick(code, 'nope', owner)).status === 400)
check('an unknown id is 404', (await kick(code, 'KM-ZZZZ-ZZZZ-ZZZZ', owner)).status === 404)
const removed = await kick(code, gus.uid, owner)
check('the owner removes Gus (notes kept)', removed.status === 200 && removed.data.removed === true && removed.data.itemsDeleted === 0, removed.data)
for (const [label, r] of [
  ['snapshot', await call('GET', `/api/boards/${code}`, undefined, { jar: gus.jar })],
  ['ops', await ops(code, gus.jar, [note('g3', 'again')])],
  ['persona', await call('PUT', `/api/boards/${code}/persona`, { persona: { kind: 'custom', name: 'Gus2', avatar: AV } }, { jar: gus.jar })],
  ['since', await call('GET', `/api/boards/${code}/since?t=0`, undefined, { jar: gus.jar })],
  ['rt/join', await call('POST', '/api/rt/join', { code }, { jar: gus.jar })],
]) check(`Gus gets 403 "removed" on ${label}`, r.status === 403 && r.data.error === 'You were removed from this board', [r.status, r.data])
const after = await call('GET', `/api/boards/${code}`, undefined, { jar: vic.jar })
check('his notes stay and others are unaffected', after.status === 200 && after.data.items.some((i) => i.id === 'g1'))
check('his name is free again', !after.data.participants.some((p) => p.name === 'Gus'))
check('no ban list in any view', !JSON.stringify(after.data).includes('bans'))
const wiped = await kick(code, vic.uid, owner, '?items=1')
check('removing Vic with items=1 deletes his notes', wiped.status === 200 && wiped.data.itemsDeleted === 1, wiped.data)
const left = (await call('GET', `/api/boards/${code}`, undefined, { jar: owner })).data.items.map((i) => i.id).sort()
check("Vic's notes are gone and Gus's remain",!left.includes('v1') && left.includes('g1'), left)

// --- CSV ---
check('export needs the owner', (await call('GET', `/api/boards/${code}/export?format=csv`, undefined, { jar: wil.jar })).status === 401)
const csv = await call('GET', `/api/boards/${code}/export?format=csv`, undefined, { jar: owner })
check('csv: 200, attachment, no-store, BOM', csv.status === 200 && /attachment; filename=".*\.csv"/.test(csv.headers.get('content-disposition')) && csv.headers.get('cache-control') === 'no-store' && csv.text.charCodeAt(0) === 0xfeff)
check('csv: header without Author, injection defused', csv.text.split('\r\n')[0].endsWith('Created') && csv.text.includes("'=cmd|calc") && !/^=cmd/m.test(csv.text))
check('csv: no author names by default', !csv.text.includes('Gus'))
const withAuthors = await call('GET', `/api/boards/${code}/export?format=csv&authors=1`, undefined, { jar: owner })
check('csv: authors=1 adds persona names only', withAuthors.text.includes('Author') && withAuthors.text.includes('Gus') && !/KM-[A-Z0-9]{4}-/.test(withAuthors.text))
check('csv: bad params are 400', (await call('GET', `/api/boards/${code}/export?format=zip`, undefined, { jar: owner })).status === 400)

check('no private cookie uid in any response body', ![...rawUids].some((u) => bodies.some((b) => b.includes(u))))
console.log(`\nall ${n} checks passed`)
