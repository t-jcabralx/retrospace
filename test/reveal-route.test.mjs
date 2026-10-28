import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { GET: revealRoute } = await import('../src/app/api/boards/[code]/reveal/route.js')
const { POST: joinRoute } = await import('../src/app/api/boards/[code]/join/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')
const { PUT: personaRoute } = await import('../src/app/api/boards/[code]/persona/route.js')
const { generatePersona } = await import('../src/lib/persona.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

async function call(handler, method, path, { body, cookie, code, ip = fakeIp() } = {}) {
  const h = { 'x-forwarded-for': ip }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data, text, res, setCookies: res.headers.getSetCookie() }
}

const reg = await call(register, 'POST', '/api/auth/register', { body: { email: `ann-${rnd()}@example.com`, name: 'ann', password: 'correct horse battery' } })
const ann = reg.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0]

async function newGuest(code) {
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
  const cookie = snap.setCookies.find((c) => c.startsWith('rs_g=')).split(';')[0]
  assert.equal((await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie, body: { persona: generatePersona() } })).status, 200)
  return cookie
}
const card = (id, over = {}) => ({ op: 'add', item: { id, kind: 'card', x: 0, y: 220, w: 300, h: 200, data: { message: `Message ${id}`, signer: 'Sam', color: 'pink', ...over } } })
const patch = (code, p) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann, body: { patch: p } })
const reveal = (code, { cookie, t } = {}) => call(revealRoute, 'GET', `/api/boards/${code}/reveal${t === undefined ? '' : `?t=${t}`}`, { code, cookie })

async function celebration(extra = {}) {
  const r = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'celebration', template: 'birthday', title: 'For Sam', recipient: { name: 'Sam Rivera' }, ...extra } })
  assert.equal(r.status, 200)
  return r.data.code
}

test('before the reveal time a guest gets the board and NO cards at all', async () => {
  const code = await celebration()
  const friend = await newGuest(code)
  assert.equal((await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('c1')] } })).data.applied.length, 1)
  assert.equal((await patch(code, { revealAt: new Date(Date.now() + 3_600_000).toISOString() })).status, 200)

  const r = await reveal(code)
  assert.equal(r.status, 200)
  assert.equal(r.data.sealed, true)
  assert.equal(r.data.role, 'guest')
  assert.ok(!('items' in r.data))
  assert.ok(!r.text.includes('Message c1') && !r.text.includes('starter-header') && !r.text.includes('Happy Birthday'), 'no card text or starter item in the answer')
  assert.equal(r.data.board.recipient.name, 'Sam Rivera')
  assert.ok(typeof r.data.board.revealAt === 'string' && typeof r.data.now === 'number')
  assert.ok(!('ownerId' in r.data.board) && !('passcodeHash' in r.data.board) && !('createdBy' in r.data.board))
  assert.ok(!('updatedAt' in r.data.board) && !('lastTs' in r.data.board), 'a sealed answer must not tell when cards are being added')
  assert.ok(Number.isInteger(r.data.board.rev) || r.data.board.rev === undefined, 'rev (settings counter) may stay')
  assert.equal(r.res.headers.get('cache-control'), 'no-store')
  assert.equal(r.setCookies.length, 0, 'a read-only view mints no guest identity')
  // activity must not leak: another card changes nothing in the sealed board
  const before = JSON.stringify(r.data.board)
  await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('c-more')] } })
  assert.equal(JSON.stringify((await reveal(code)).data.board), before)
  const withT = await reveal(code, { t: 0 })
  assert.equal(withT.data.sealed, true)
  assert.ok(!('items' in withT.data))
})

test('the owner previews: cards are included even before the reveal time', async () => {
  const code = await celebration()
  const friend = await newGuest(code)
  await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('c1')] } })
  await patch(code, { revealAt: new Date(Date.now() + 3_600_000).toISOString() })
  const r = await reveal(code, { cookie: ann })
  assert.equal(r.data.role, 'owner')
  assert.ok('updatedAt' in r.data.board, 'the owner and revealed answers are unchanged: they keep updatedAt')
  assert.equal(r.data.sealed, false)
  assert.deepEqual(r.data.items.map((i) => i.id), ['c1'])
  assert.ok('ownerId' in r.data.board, 'the owner still sees their own view of the board')
})

test('after the reveal time (or with none) the guest gets the cards, and only cards', async () => {
  const code = await celebration()
  const friend = await newGuest(code)
  const note = { op: 'add', item: { id: 'n1', kind: 'note', x: 0, y: 0, w: 100, h: 100, data: { text: 'not a card', color: 'yellow' } } }
  await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('c1'), card('c2'), note] } })
  const open = await reveal(code)
  assert.equal(open.data.sealed, false)
  assert.ok('updatedAt' in open.data.board && 'lastTs' in open.data.board)
  assert.deepEqual(open.data.items.map((i) => i.id).sort(), ['c1', 'c2'])
  assert.ok(!open.text.includes('not a card') && !open.text.includes('Happy Birthday'))

  await patch(code, { revealAt: new Date(Date.now() + 3_600_000).toISOString() })
  assert.equal((await reveal(code)).data.sealed, true)
  await patch(code, { revealAt: new Date(Date.now() - 1000).toISOString() })
  const done = await reveal(code)
  assert.equal(done.data.sealed, false)
  assert.equal(done.data.items.length, 2)
  await patch(code, { revealAt: null })
  assert.equal((await reveal(code)).data.sealed, false)
})

test('t returns only what changed since, deletions included', async () => {
  const code = await celebration()
  const friend = await newGuest(code)
  await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('c1')] } })
  const first = await reveal(code)
  const newest = Math.max(...first.data.items.map((i) => i.updatedAt))
  assert.equal((await reveal(code, { t: newest })).data.items.length, 0)
  await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('c2'), { op: 'delete', id: 'c1' }] } })
  const since = await reveal(code, { t: newest })
  assert.deepEqual(since.data.items.map((i) => [i.id, Boolean(i.deleted)]).sort(), [['c1', true], ['c2', false]])
})

test('bad t, bad code, unknown board', async () => {
  const code = await celebration()
  for (const t of ['abc', '', 'NaN']) assert.equal((await call(revealRoute, 'GET', `/api/boards/${code}/reveal?t=${t}`, { code })).status, 400, t)
  assert.equal((await call(revealRoute, 'GET', '/api/boards/abc/reveal', { code: 'abc' })).status, 400)
  assert.equal((await call(revealRoute, 'GET', '/api/boards/ZZZZZZ/reveal', { code: 'ZZZZZZ' })).status, 404)
})

test('a passcode board answers 401 without the access cookie, and a revoked one 403 (the owner passes both)', async () => {
  const code = await celebration()
  await patch(code, { passcode: 'open sesame' })
  const denied = await reveal(code)
  assert.deepEqual([denied.status, denied.data.error], [401, 'Passcode required'])
  const joined = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'open sesame' } })
  const access = joined.setCookies.find((c) => c.startsWith(`rs_a_${code}=`)).split(';')[0]
  assert.equal((await reveal(code, { cookie: access })).status, 200)
  await patch(code, { revoked: true })
  const revoked = await reveal(code, { cookie: access })
  assert.deepEqual([revoked.status, revoked.data.error], [403, 'This link was revoked'])
  assert.equal((await reveal(code, { cookie: ann })).status, 200)
})

test('cards over the ops route: a guest can add a valid one; bad text, colour, link or image is refused', async () => {
  const code = await celebration()
  const friend = await newGuest(code)
  const send = (...ops) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops } })
  const ok = await send(card('good', { gif: 'https://media.giphy.com/media/x/200.gif', mediaW: 356, mediaH: 200 }))
  assert.equal(ok.data.applied.length, 1)
  assert.equal(ok.data.applied[0].authorName.length > 0, true)
  const bad = await send(
    card('b1', { message: 'x'.repeat(501) }),
    card('b2', { signer: '' }),
    card('b3', { signer: 's'.repeat(41) }),
    card('b4', { gif: 'javascript:alert(1)' }),
    card('b5', { color: 'red' }),
    card('b6', { image: `data:image/png;base64,${'A'.repeat(600 * 1024)}` }),
    card('b7', { message: '   ' }),
  )
  assert.equal(bad.data.applied.length, 0)
  assert.equal(bad.data.rejected.length, 7)
  const edit = await send({ op: 'update', id: 'good', patch: { data: { message: 'Edited by author' } } })
  assert.equal(edit.data.applied[0].data.message, 'Edited by author')
  const blank = await send({ op: 'update', id: 'good', patch: { data: { message: '' } } })
  assert.equal(blank.data.applied.length, 0)
  const stranger = await newGuest(code)
  const other = await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: stranger, body: { ops: [{ op: 'update', id: 'good', patch: { data: { message: 'hijack' } } }] } })
  assert.equal(other.data.applied.length, 0)
})

test('guests cannot add cards on a locked or closed board; the owner can', async () => {
  const code = await celebration()
  const friend = await newGuest(code)
  const add = (id, cookie) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: [card(id)] } })
  assert.equal((await patch(code, { locked: true })).status, 200)
  const locked = await add('l1', friend)
  assert.deepEqual([locked.data.applied.length, locked.data.rejected[0].error], [0, 'Board is locked'])
  assert.equal((await add('l2', ann)).data.applied.length, 1)
  await patch(code, { locked: false, status: 'closed' })
  const closed = await add('l3', friend)
  assert.equal(closed.status, 403)
  assert.equal((await add('l4', ann)).data.applied.length, 1)
})

test('ACCEPTED LIMIT: before the reveal time /since and the snapshot still return the cards (the code is the only secret)', async () => {
  const { GET: since } = await import('../src/app/api/boards/[code]/since/route.js')
  const code = await celebration()
  const friend = await newGuest(code)
  await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: friend, body: { ops: [card('early')] } })
  await patch(code, { revealAt: new Date(Date.now() + 3_600_000).toISOString() })
  assert.equal((await reveal(code)).data.sealed, true)
  const s = await call(since, 'GET', `/api/boards/${code}/since?t=0`, { code })
  assert.ok(s.data.items.some((i) => i.id === 'early'), '/since is not sealed: the reveal page is a nicety, not a security boundary')
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
  assert.ok(snap.data.items.some((i) => i.id === 'early'), 'neither is the snapshot of /b/[code]')
})
