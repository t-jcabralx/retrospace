import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Route handlers go through getStore(); force the in-memory store and no Redis whatever the shell has set.
for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { POST: peopleRoute } = await import('../src/app/api/boards/[code]/people/route.js')
const { GET: namesRoute } = await import('../src/app/api/boards/[code]/people-names/route.js')
const { GET: milestonesRoute } = await import('../src/app/api/boards/[code]/milestones/route.js')
const { GET: sinceRoute } = await import('../src/app/api/boards/[code]/since/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')
const { PUT: personaRoute } = await import('../src/app/api/boards/[code]/persona/route.js')
const { generatePersona } = await import('../src/lib/persona.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`
const bodies = []

async function call(handler, method, path, { body, raw, cookie, ip = fakeIp(), headers = {}, code } = {}) {
  const h = { 'x-forwarded-for': ip, ...headers }
  if (body !== undefined || raw !== undefined) h['content-type'] ??= 'application/json'
  if (cookie) h.cookie = Array.isArray(cookie) ? cookie.join('; ') : cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), code ? { params: Promise.resolve({ code }) } : undefined)
  const text = await res.text()
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data, res, setCookies: res.headers.getSetCookie() }
}

async function signUp(name) {
  const r = await call(register, 'POST', '/api/auth/register', { body: { email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' } })
  assert.equal(r.status, 200)
  return { id: r.data.user.id, cookie: r.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0] }
}

// A guest browser: GET the snapshot (which mints the rs_g cookie), then choose a persona. -> the Cookie header value.
async function newGuest(code, extraCookie, { persona = true } = {}) {
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: extraCookie })
  assert.equal(snap.status, 200)
  const rsg = snap.setCookies.find((c) => c.startsWith('rs_g='))
  assert.ok(rsg, 'the snapshot mints the guest cookie')
  const cookie = [extraCookie, rsg.split(';')[0]].filter(Boolean).join('; ')
  if (persona) {
    const put = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie, body: { persona: generatePersona() } })
    assert.equal(put.status, 200)
  }
  return cookie
}


// The per-minute limits are fixed windows; a test that counts exactly must not straddle a minute boundary.
async function roomInMinute(needMs = 10_000) {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100))
}

const so = (id, over = {}) => ({ op: 'add', item: { id, kind: 'shoutout', x: 0, y: 0, w: 320, h: 280, data: { toName: 'Ana', message: 'Great job', badge: 'Teamwork', ...over } } })
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const ann = await signUp('ann')

async function wall() {
  const created = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'wall', template: 'team', title: 'Team' } })
  assert.equal(created.status, 200)
  return created.data.code
}

test('the snapshot sends people to the owner only; a guest gets none (names come from people-names); birthdays never leak', async () => {
  const code = await wall()
  const people = [{ id: 'p1', name: 'Ana', birthday: '03-14', startDate: '2020-05-06' }, { id: 'p2', name: 'Bo', birthday: null, startDate: null }]
  const saved = await call(peopleRoute, 'POST', `/api/boards/${code}/people`, { code, cookie: ann.cookie, body: { people } })
  assert.equal(saved.status, 200)
  const guest = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
  assert.deepEqual(guest.data.people, [])
  assert.ok(!JSON.stringify(guest.data).includes('03-14') && !JSON.stringify(guest.data).includes('2020-05-06'))
  const owner = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: ann.cookie })
  assert.equal(owner.data.people[0].birthday, '03-14')
  const since = await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code })
  assert.ok(!JSON.stringify(since.data).includes('03-14'))
})

test('milestones: validated ?today, only the viewer-day matches, no raw dates, read access applies', async () => {
  const code = await wall()
  const today = new Date()
  const md = `${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const start = `${today.getFullYear() - 2}-${md}`
  const people = [
    { id: 'p1', name: 'Ana', birthday: md, startDate: null },
    { id: 'p2', name: 'Bo', birthday: null, startDate: start },
    { id: 'p3', name: 'Cy', birthday: '01-01', startDate: '2019-01-01' },
  ]
  assert.equal((await call(peopleRoute, 'POST', `/api/boards/${code}/people`, { code, cookie: ann.cookie, body: { people } })).status, 200)
  const get = (q, cookie) => call(milestonesRoute, 'GET', `/api/boards/${code}/milestones${q}`, { code, cookie })
  const ok = await get(`?today=${ymd(today)}`)
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.data, [{ personId: 'p1', name: 'Ana', kind: 'birthday' }, { personId: 'p2', name: 'Bo', kind: 'anniversary', years: 2 }])
  assert.ok(!JSON.stringify(ok.data).includes(md) && !JSON.stringify(ok.data).includes(start))
  assert.equal((await get(`?today=${ymd(today)}`, ann.cookie)).status, 200)
  for (const q of ['', '?today=', '?today=tomorrow', '?today=2026-02-30', '?today=1999-01-01', `?today=${ymd(new Date(Date.now() + 5 * 86_400_000))}`]) {
    assert.equal((await get(q)).status, 400, q)
  }
  assert.deepEqual((await get('?today=2030-12-31')).status, 400, 'a guest cannot probe other days')
  assert.equal((await call(milestonesRoute, 'GET', '/api/boards/ZZZZZZ/milestones?today=2026-10-28', { code: 'ZZZZZZ' })).status, 404)
  // read access: a passcode board refuses a guest without the cookie
  assert.equal((await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'open sesame' } } })).status, 200)
  const denied = await get(`?today=${ymd(today)}`)
  assert.deepEqual([denied.status, denied.data.error], [401, 'Passcode required'])
  assert.equal((await get(`?today=${ymd(today)}`, ann.cookie)).status, 200)
})

test('milestones on a workshop board is an empty list', async () => {
  const made = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T' } })
  const code = made.data.code
  const r = await call(milestonesRoute, 'GET', `/api/boards/${code}/milestones?today=${ymd(new Date())}`, { code })
  assert.deepEqual([r.status, r.data], [200, []])
})

test('a guest posts shout-outs; the 11th in a minute is refused with Slow down; the owner is counted on their own', async () => {
  const code = await wall()
  const gus = await newGuest(code)
  const gus2 = await newGuest(code)
  const ops = (cookie, list) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: list } })
  const bad = await ops(gus, [so('bad', { badge: 'Nope' }), so('http', { gif: 'http://x.example/a.gif' })])
  assert.deepEqual([bad.data.applied.length, bad.data.rejected.length], [0, 2])
  await roomInMinute()
  const first = await ops(gus, Array.from({ length: 10 }, (_, i) => so(`s${i}`)))
  assert.equal(first.data.applied.length, 10)
  const eleventh = await ops(gus, [so('s10')])
  assert.deepEqual([eleventh.data.applied.length, eleventh.data.rejected], [0, [{ id: 's10', error: 'Slow down' }]])
  assert.equal((await ops(gus, [{ op: 'react', id: 's0', emoji: '🎉' }])).data.applied.length, 1, 'reactions are not shout-out adds')
  assert.equal((await ops(gus2, [so('other')])).data.applied.length, 1, 'another participant has their own budget')
})

test('moderation: the owner deletes any shout-out; a guest only their own; reactions toggle for everyone', async () => {
  const code = await wall()
  const a = await newGuest(code)
  const b = await newGuest(code)
  const owner = await newGuest(code, ann.cookie, { persona: false })
  const ops = (cookie, list) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: list } })
  assert.equal((await ops(a, [so('mine')])).data.applied.length, 1)
  assert.equal((await ops(b, [so('theirs')])).data.applied.length, 1)
  const denied = await ops(b, [{ op: 'delete', id: 'mine' }])
  assert.deepEqual(denied.data.rejected, [{ id: 'mine', error: 'Not allowed' }])
  assert.equal((await ops(b, [{ op: 'delete', id: 'theirs' }])).data.applied.length, 1)
  const r1 = await ops(b, [{ op: 'react', id: 'mine', emoji: '🔥' }])
  assert.equal(r1.data.applied[0].reactions['🔥'].length, 1)
  assert.equal((await ops(owner, [{ op: 'delete', id: 'mine' }])).data.applied.length, 1)
})

test('people-names: guests get [{ id, name }] only; read access applies; other board types get an empty list', async () => {
  const code = await wall()
  const people = [{ id: 'p1', name: 'Ana', birthday: '03-14', startDate: '2020-05-06' }, { id: 'p2', name: 'Bo', birthday: null, startDate: null }]
  assert.equal((await call(peopleRoute, 'POST', `/api/boards/${code}/people`, { code, cookie: ann.cookie, body: { people } })).status, 200)
  const r = await call(namesRoute, 'GET', `/api/boards/${code}/people-names`, { code })
  assert.deepEqual([r.status, r.data], [200, [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }]])
  assert.equal(r.res.headers.get('cache-control'), 'no-store')
  assert.ok(!JSON.stringify(r.data).includes('03-14') && !JSON.stringify(r.data).includes('2020'))
  assert.equal((await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'open sesame' } } })).status, 200)
  assert.equal((await call(namesRoute, 'GET', `/api/boards/${code}/people-names`, { code })).status, 401)
  assert.equal((await call(namesRoute, 'GET', `/api/boards/${code}/people-names`, { code, cookie: ann.cookie })).status, 200)
  const made = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T' } })
  assert.deepEqual((await call(namesRoute, 'GET', `/api/boards/${made.data.code}/people-names`, { code: made.data.code })).data, [])
})
