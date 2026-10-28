// Black-box simulation of configurable columns and saved templates. Usage: node scripts/sim-columns.mjs [baseUrl]
// (default http://localhost:3000; start a FRESH server with blanked services, rate limits live in its process).
// Exits non-zero on the first failed assertion.
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { columnFrames, retitleOp, moveColumnOps, addColumnOp, removeColumnOps } from '../src/ui/columnOps.js'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`

async function call(method, path, body, { cookie, headers = {} } = {}) {
  const h = { 'x-forwarded-for': fakeIp(), ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
  return { status: res.status, data, setCookies: res.headers.getSetCookie() }
}
const step = (name) => console.log(`- ${name}`)

const reg = await call('POST', '/api/auth/register', { email: `cols-${rnd()}@example.com`, name: 'Cora', password: 'correct horse battery' })
assert.equal(reg.status, 200)
const owner = reg.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0]

step('six custom columns with emoji, trimmed, a custom header')
const cols = [{ title: ' Start ', emoji: '🚀' }, { title: 'Stop', emoji: '' }, { title: 'Keep', emoji: '✅' }, { title: 'Risks', emoji: '⚠️' }, { title: 'Kudos', emoji: '👏' }, { title: 'Parking lot' }]
const made = await call('POST', '/api/boards', { type: 'retro', template: 'retro-ssc', title: 'Sim columns', columns: cols, header: 'Be kind.' }, { cookie: owner })
assert.equal(made.status, 200)
const code = made.data.code
const snap = async (cookie) => (await call('GET', `/api/boards/${code}`, undefined, { cookie })).data
let items = (await snap(owner)).items
assert.deepEqual(columnFrames(items).map((c) => c.data.title), ['🚀 Start', 'Stop', '✅ Keep', '⚠️ Risks', '👏 Kudos', 'Parking lot'])
assert.equal(items.find((i) => i.kind === 'text').data.text, 'Be kind.')

step('invalid columns are refused and create nothing')
for (const columns of [[], Array.from({ length: 9 }, (_, i) => ({ title: `c${i}` })), [{ title: 'a', emoji: 'xx' }], [{ title: '‮​' }], 'nope']) {
  const bad = await call('POST', '/api/boards', { type: 'retro', template: 'retro-ssc', title: 'x', columns }, { cookie: owner })
  assert.equal(bad.status, 400, JSON.stringify(columns))
}

step('a guest watches the owner rename, move, add and remove a column')
const guestSnap = await call('GET', `/api/boards/${code}`)
assert.equal(guestSnap.status, 200)
assert.ok(!('ownerId' in guestSnap.data.board), 'a guest never learns who owns the board')
const ops = async (list) => {
  const r = await call('POST', `/api/boards/${code}/ops`, { ops: list }, { cookie: owner })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return (await snap(owner)).items
}
items = await ops([retitleOp(columnFrames(items)[1], { title: 'Halt', emoji: '🛑' })])
items = await ops(moveColumnOps(items, columnFrames(items)[1].id, -1))
items = await ops([addColumnOp(items, { title: 'Later' })])
items = await ops(removeColumnOps(items, columnFrames(items)[5].id))
const seen = columnFrames((await snap()).items).map((c) => c.data.title)
assert.deepEqual(seen, ['🛑 Halt', '🚀 Start', '✅ Keep', '⚠️ Risks', '👏 Kudos', 'Later'])

step('saved templates: session, same origin, validation, uniqueness, list, reuse, delete, privacy')
assert.equal((await call('GET', '/api/templates')).status, 401)
assert.equal((await call('POST', '/api/templates', { name: 'x', type: 'retro', columns: cols })).status, 401)
assert.equal((await call('POST', '/api/templates', { name: 'x', type: 'retro', columns: cols }, { cookie: owner, headers: { origin: 'http://evil.example' } })).status, 403)
assert.equal((await call('POST', '/api/templates', { name: '', type: 'retro', columns: cols }, { cookie: owner })).status, 400)
const saved = await call('POST', '/api/templates', { name: 'Sim template', type: 'retro', columns: cols }, { cookie: owner })
assert.equal(saved.status, 200)
assert.equal((await call('POST', '/api/templates', { name: 'sim TEMPLATE', type: 'retro', columns: cols }, { cookie: owner })).status, 409)
const list = await call('GET', '/api/templates', undefined, { cookie: owner })
assert.deepEqual(list.data.templates.map((t) => t.name), ['Sim template'])
const reuse = await call('POST', '/api/boards', { type: 'retro', template: 'retro-msg', title: 'Reuse', columns: list.data.templates[0].columns }, { cookie: owner })
assert.equal(columnFrames((await call('GET', `/api/boards/${reuse.data.code}`, undefined, { cookie: owner })).data.items).length, 6)
const other = await call('POST', '/api/auth/register', { email: `cols2-${rnd()}@example.com`, name: 'Otto', password: 'correct horse battery' })
const otherCookie = other.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0]
assert.deepEqual((await call('GET', '/api/templates', undefined, { cookie: otherCookie })).data.templates, [])
const id = saved.data.template.id
assert.equal((await call('DELETE', `/api/templates/${id}`, undefined, { cookie: otherCookie })).status, 404)
assert.equal((await call('DELETE', `/api/templates/${id}`, undefined, { cookie: owner })).status, 200)
assert.equal((await call('GET', '/api/templates', undefined, { cookie: owner })).data.templates.length, 0)
console.log('sim-columns: all checks passed')
