import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Route handlers go through getStore(); force the in-memory store and no Redis whatever the shell has set.
for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { POST: peopleRoute } = await import('../src/app/api/boards/[code]/people/route.js')
const { GET: sinceRoute } = await import('../src/app/api/boards/[code]/since/route.js')
const { POST: joinRoute } = await import('../src/app/api/boards/[code]/join/route.js')
const { GET: joinInfo } = await import('../src/app/api/join/[code]/route.js')
const { GET: myBoards } = await import('../src/app/api/my-boards/route.js')
const { POST: rtJoin } = await import('../src/app/api/rt/join/route.js')
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

const note = (id) => ({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text: 'hi' } } })
const newBoard = (cookie, extra = {}) => call(createBoard, 'POST', '/api/boards', { cookie, body: { type: 'workshop', template: 'blank', title: 'T', ...extra } })

const ann = await signUp('ann')
const bob = await signUp('bob')

test('create needs a session, JSON and a same-origin request; it returns only the code', async () => {
  const anon = await newBoard(undefined)
  assert.deepEqual([anon.status, anon.data.error], [401, 'Sign in to create a board'])
  const text = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, raw: '{}', headers: { 'content-type': 'text/plain' } })
  assert.equal(text.status, 415)
  const foreign = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: {}, headers: { origin: 'http://evil.example' } })
  assert.equal(foreign.status, 403)
  const ok = await newBoard(ann.cookie)
  assert.equal(ok.status, 200)
  assert.deepEqual(Object.keys(ok.data), ['code'])
  const code = ok.data.code
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
  assert.ok(!('ownerId' in snap.data.board) && !('createdBy' in snap.data.board), 'a guest never learns who owns the board')
  const mine = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: ann.cookie })
  assert.deepEqual([mine.data.board.ownerId, mine.data.board.createdBy], [ann.id, ann.id])
  const other = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: bob.cookie })
  assert.ok(!('ownerId' in other.data.board) && !('createdBy' in other.data.board), 'nor does another signed-in account')
  assert.deepEqual([snap.data.board.status, snap.data.board.revoked], ['open', false])
  assert.ok(!('passcodeHash' in snap.data.board))
  assert.deepEqual(Object.keys(snap.data.viewer).sort(), ['persona', 'role', 'uid'])
  assert.deepEqual([snap.data.viewer.role, snap.data.viewer.persona], ['guest', null])
  assert.match(snap.data.viewer.uid, /^KM-/)
  assert.equal(ok.setCookies.some((c) => c.startsWith('rs_g=')), false, 'creating a board needs no guest cookie: the owner is identified by the account')
})

test('the viewer is the owner only with the owner session, and guests cannot PATCH or DELETE', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  const as = async (cookie) => {
    const { role, userId } = (await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie })).data.viewer
    return { role, userId }
  }
  assert.deepEqual(await as(ann.cookie), { role: 'owner', userId: ann.id })
  assert.deepEqual(await as(bob.cookie), { role: 'guest', userId: bob.id })
  const patch = { patch: { locked: true } }
  assert.equal((await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, body: patch })).status, 401)
  const other = await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: bob.cookie, body: patch })
  assert.deepEqual([other.status, other.data.error], [403, 'Not the owner'])
  assert.equal((await call(board.DELETE, 'DELETE', `/api/boards/${code}`, { code, cookie: bob.cookie })).status, 403)
  assert.equal((await call(peopleRoute, 'POST', `/api/boards/${code}/people`, { code, cookie: bob.cookie, body: { people: [] } })).status, 403)
  const mine = await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: patch })
  assert.equal(mine.status, 200)
  assert.equal(mine.data.board.locked, true)
  assert.equal((await call(board.DELETE, 'DELETE', `/api/boards/${code}`, { code, cookie: ann.cookie })).status, 200)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code })).status, 404)
})

test('PATCH and DELETE reject a cross-origin request and a non-JSON body', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  const patch = { patch: { title: 'x' } }
  assert.equal((await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: patch, headers: { origin: 'http://evil.example' } })).status, 403)
  assert.equal((await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, raw: '{}', headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call(board.DELETE, 'DELETE', `/api/boards/${code}`, { code, cookie: ann.cookie, headers: { origin: 'http://evil.example' } })).status, 403)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code })).status, 200) // nothing changed
})

test('passcode flow: 401 without the cookie, wrong passcode 403, right passcode sets the cookie, a new passcode revokes it', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  const set = (passcode) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode } } })
  const read = (cookie) => call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie })
  const s = await set('open sesame')
  assert.equal(s.status, 200)
  assert.ok(!('passcodeHash' in s.data.board) && !JSON.stringify(s.data).includes('open sesame'))

  const denied = await read()
  assert.deepEqual([denied.status, denied.data.error], [401, 'Passcode required'])
  assert.equal((await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code })).status, 401)
  assert.equal((await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, body: { ops: [note('a')] } })).status, 401)
  assert.equal((await call(rtJoin, 'POST', '/api/rt/join', { body: { code } })).status, 401)
  assert.equal((await read(ann.cookie)).status, 200) // the owner needs nothing

  const wrong = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'nope nope' } })
  assert.deepEqual([wrong.status, wrong.data.error, wrong.setCookies.length], [403, 'Wrong passcode', 0])
  const right = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'open sesame' } })
  assert.equal(right.status, 200)
  assert.deepEqual(right.data, { ok: true })
  const cookie = right.setCookies.find((c) => c.startsWith(`rs_a_${code}=`))
  assert.ok(cookie && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'))
  const access = cookie.split(';')[0]
  const viewer = await read(access)
  assert.equal(viewer.status, 200)
  assert.equal(viewer.data.viewer.role, 'guest')
  const guestCookie = await newGuest(code, access)
  assert.equal((await call(rtJoin, 'POST', '/api/rt/join', { cookie: guestCookie, body: { code } })).status, 200)
  assert.equal((await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: guestCookie, body: { ops: [note('a')] } })).data.applied.length, 1)

  assert.equal((await set('a new passcode')).status, 200)
  assert.equal((await read(access)).status, 401) // the old cookie died with the old passcode
  assert.equal((await set(null)).status, 200)
  assert.equal((await read()).status, 200) // no passcode: open again
  const open = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: {} })
  assert.deepEqual([open.status, open.data, open.setCookies.length], [200, { ok: true }, 0])
})

test('closed boards refuse guest writes with a reason; revoked boards refuse guests entirely; the owner is exempt', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  const patch = (p) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: p } })
  const gus = await newGuest(code)
  const annBrowser = await newGuest(code, ann.cookie, { persona: false }) // the owner has a guest identity too (and an account persona)
  const guestOps = (id) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: gus, body: { ops: [note(id)] } })
  const ownerOps = (id) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: annBrowser, body: { ops: [note(id)] } })
  assert.equal((await patch({ status: 'closed' })).data.board.status, 'closed')
  const closed = await guestOps('g1')
  assert.deepEqual([closed.status, closed.data.error], [403, 'Board is closed'])
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code })).status, 200) // reading is fine
  assert.equal((await ownerOps('o1')).data.applied.length, 1)
  assert.equal((await patch({ status: 'open' })).status, 200)
  assert.equal((await guestOps('g2')).data.applied.length, 1)

  assert.equal((await patch({ revoked: true })).data.board.revoked, true)
  for (const r of [await call(board.GET, 'GET', `/api/boards/${code}`, { code }), await guestOps('g3'), await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code })]) {
    assert.deepEqual([r.status, r.data.error], [403, 'This link was revoked'])
  }
  assert.equal((await call(rtJoin, 'POST', '/api/rt/join', { cookie: gus, body: { code } })).status, 403)
  assert.equal((await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: {} })).status, 403)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: ann.cookie })).status, 200)
  assert.equal((await ownerOps('o2')).data.applied.length, 1)
  assert.equal((await call(peopleRoute, 'POST', `/api/boards/${code}/people`, { code, cookie: ann.cookie, body: { people: [] } })).status, 200)
})

test('GET /api/join/[code] is public and returns exactly five fields', async () => {
  const { data: { code } } = await newBoard(ann.cookie, { title: 'Secret roadmap', type: 'celebration', template: 'birthday', recipient: { name: 'Sam' } })
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'letmein!' } } })
  const r = await call(joinInfo, 'GET', `/api/join/${code}`, { code })
  assert.equal(r.status, 200)
  assert.deepEqual(r.data, { exists: true, title: 'Secret roadmap', type: 'celebration', needsPasscode: true, closed: false, revoked: false })
  assert.equal(r.res.headers.get('cache-control'), 'no-store')
  const none = await call(joinInfo, 'GET', '/api/join/ZZZZZZ', { code: 'ZZZZZZ' })
  assert.deepEqual([none.status, none.data], [404, { exists: false }])
  assert.equal((await call(joinInfo, 'GET', '/api/join/abc', { code: 'abc' })).status, 400)
})

test('join rate limits: 10 a minute per IP, and 30 failures per board per 15 minutes with Retry-After', async () => {
  await roomInMinute()
  const { data: { code } } = await newBoard(ann.cookie)
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'letmein!' } } })
  const ip = fakeIp()
  const tries = []
  for (let i = 0; i < 11; i++) tries.push(await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, ip, body: { passcode: `wrong-${i}` } }))
  assert.deepEqual(tries.slice(0, 10).map((t) => t.status), Array(10).fill(403))
  assert.equal(tries[10].status, 429)
  assert.ok(Number(tries[10].res.headers.get('retry-after')) > 0)

  // from many addresses: the 31st failed attempt against one board is refused, even with the right passcode
  let blocked = null
  for (let i = 0; i < 40 && !blocked; i++) {
    const t = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: `guess-${i}` } })
    if (t.status === 429) blocked = { at: i, t }
  }
  assert.ok(blocked, 'expected the per-board limit to trip')
  assert.ok(blocked.at <= 20, `tripped after ${blocked.at} more (11 were already used)`)
  const right = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'letmein!' } })
  assert.equal(right.status, 429)
  assert.ok(Number(right.res.headers.get('retry-after')) > 0)
})

test('my-boards needs a session and lists only the account\'s own boards', async () => {
  const carol = await signUp('carol')
  assert.equal((await call(myBoards, 'GET', '/api/my-boards')).status, 401)
  assert.deepEqual((await call(myBoards, 'GET', '/api/my-boards', { cookie: carol.cookie })).data, { boards: [] })
  const made = []
  for (const [type, template] of [['workshop', 'blank'], ['celebration', 'birthday'], ['wall', 'team'], ['workshop', 'retro'], ['celebration', 'farewell']]) {
    made.push((await newBoard(carol.cookie, { type, template, title: `${type}-${template}` })).data.code)
  }
  assert.equal(new Set(made).size, 5)
  assert.ok(made.every((c) => /^[2-9A-HJKMNP-Z]{6}$/.test(c)))
  const mine = await call(myBoards, 'GET', '/api/my-boards', { cookie: carol.cookie })
  assert.deepEqual(mine.data.boards.map((b) => b.code).sort(), [...made].sort())
  assert.ok(mine.data.boards.every((b) => b.title === `${b.type}-${b.template}` && b.ownerId === carol.id && !('passcodeHash' in b) && b.hasPasscode === false))
  const bobs = await call(myBoards, 'GET', '/api/my-boards', { cookie: bob.cookie })
  assert.ok(bobs.data.boards.every((b) => !made.includes(b.code)))
})

test('a response never contains a hash or a plaintext passcode', () => {
  for (const text of bodies) {
    for (const needle of ['passcodeHash', 'ownerKeyHash', 'passwordHash', 'scrypt$', 'open sesame', 'a new passcode', 'letmein!']) assert.ok(!text.includes(needle), `${needle} leaked in ${text.slice(0, 120)}`)
  }
})

test('every mutating board route refuses "Origin: null" and a foreign Origin with 403', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  const guestBody = { ops: [note('o1')] }
  const cases = [
    ['create', () => call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T' }, headers })],
    ['PATCH', () => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { title: 'x' } }, headers })],
    ['DELETE', () => call(board.DELETE, 'DELETE', `/api/boards/${code}`, { code, cookie: ann.cookie, headers })],
    ['ops', () => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, body: guestBody, headers })],
    ['people', () => call(peopleRoute, 'POST', `/api/boards/${code}/people`, { code, cookie: ann.cookie, body: { people: [] }, headers })],
    ['join', () => call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: {}, headers })],
    ['rt join', () => call(rtJoin, 'POST', '/api/rt/join', { body: { code }, headers })],
    ['persona', () => call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, body: { persona: generatePersona() }, headers })],
  ]
  let headers
  for (const origin of ['null', 'http://evil.example']) {
    headers = { origin }
    for (const [name, run] of cases) assert.equal((await run()).status, 403, `${name} with Origin ${origin}`)
  }
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code })).status, 200)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code })).data.items.some((i) => i.id === 'o1'), false)
})

test('probing limiter: the 21st unknown code from one IP in a minute is 429 with Retry-After; another IP is unaffected', async () => {
  await roomInMinute()
  const ip = fakeIp()
  const miss = (n, who = ip) => call(board.GET, 'GET', '/api/boards/ZZZZ2' + 'ABCDEFGHJKMNPQRSTUVWXYZ'[n % 23], { code: 'ZZZZ2' + 'ABCDEFGHJKMNPQRSTUVWXYZ'[n % 23], ip: who })
  for (let i = 0; i < 20; i++) assert.equal((await miss(i)).status, 404, `miss ${i + 1}`)
  const blocked = await miss(20)
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0)
  assert.equal((await miss(21, fakeIp())).status, 404)
  // the block covers every board route, and even an existing board, for this IP
  const { data: { code } } = await newBoard(ann.cookie)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, ip })).status, 429)
  assert.equal((await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code, ip })).status, 429)
  assert.equal((await call(rtJoin, 'POST', '/api/rt/join', { body: { code }, ip })).status, 429)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, ip: fakeIp() })).status, 200)
})

test('probing limiter: successful polling is never throttled (300 reads in a minute from one IP)', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  const ip = fakeIp()
  for (let i = 0; i < 300; i++) {
    const r = await call(i % 2 ? sinceRoute : board.GET, 'GET', i % 2 ? `/api/boards/${code}/since?t=0` : `/api/boards/${code}`, { code, ip })
    assert.equal(r.status, 200, `read ${i + 1}`)
  }
})

test('probing limiter: a classroom of 30 guests behind one IP meeting a passcode board (30 x 401) is not throttled, but 200 denials are', async () => {
  await roomInMinute()
  const { data: { code } } = await newBoard(ann.cookie)
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'class-pass' } } })
  const ip = fakeIp()
  for (let i = 0; i < 30; i++) assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, ip })).status, 401)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, ip })).status, 401) // the 404 budget is untouched
  for (let i = 31; i < 200; i++) assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, ip })).status, 401, `denial ${i + 1}`)
  assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, ip })).status, 429) // 200 denials reached
})

test('join budget: a success refunds its own slot but never resets the counter (29 wrong + success + wrong -> allowed, then 429)', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'budget-pass' } } })
  const join = (passcode) => call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode } })
  for (let i = 0; i < 29; i++) assert.equal((await join(`wrong-${i}`)).status, 403)
  assert.equal((await join('budget-pass')).status, 200) // reserved the 30th slot, then gave it back: 29 failures on record
  assert.equal((await join('wrong-a')).status, 403) // the 30th failure
  assert.equal((await join('wrong-b')).status, 429) // the 31st is refused: the budget was not reset
  assert.equal((await join('budget-pass')).status, 429) // fail closed, even with the right passcode
})

test('join budget: a classroom of successes does not use up the budget', async () => {
  const { data: { code } } = await newBoard(ann.cookie)
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'class-pass' } } })
  for (let i = 0; i < 40; i++) assert.equal((await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'class-pass' } })).status, 200, `join ${i + 1}`)
  for (let i = 0; i < 30; i++) assert.equal((await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: `nope-${i}` } })).status, 403)
  assert.equal((await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'nope-x' } })).status, 429)
})

test('GET /api/join/[code] shares the unknown-code budget with the board routes: the 21st miss is 429 with Retry-After', async () => {
  await roomInMinute()
  const ip = fakeIp()
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const codeOf = (i) => `YYYY2${letters[i % letters.length]}`
  for (let i = 0; i < 10; i++) assert.equal((await call(joinInfo, 'GET', `/api/join/${codeOf(i)}`, { code: codeOf(i), ip })).status, 404, `join info miss ${i + 1}`)
  for (let i = 10; i < 20; i++) assert.equal((await call(board.GET, 'GET', `/api/boards/${codeOf(i)}`, { code: codeOf(i), ip })).status, 404, `board miss ${i + 1}`)
  const blocked = await call(joinInfo, 'GET', `/api/join/${codeOf(20)}`, { code: codeOf(20), ip })
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0)
  // an existing board's join info is refused too while the IP is blocked; another IP is fine
  const { data: { code } } = await newBoard(ann.cookie)
  assert.equal((await call(joinInfo, 'GET', `/api/join/${code}`, { code, ip })).status, 429)
  assert.equal((await call(joinInfo, 'GET', `/api/join/${code}`, { code, ip: fakeIp() })).status, 200)
  // successful lookups are never counted against the miss budget
  const calm = fakeIp()
  for (let i = 0; i < 40; i++) assert.equal((await call(joinInfo, 'GET', `/api/join/${code}`, { code, ip: calm })).status, 200, `lookup ${i + 1}`)
})
