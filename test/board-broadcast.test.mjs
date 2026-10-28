import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { GET: sinceRoute } = await import('../src/app/api/boards/[code]/since/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')
const { POST: send } = await import('../src/app/api/rt/send/route.js')
const { signTok } = await import('../src/lib/rt.js')
const { publicIdForUser, mintGuest, publicId } = await import('../src/lib/guest.js')
const { getStore } = await import('../src/lib/store.js')
const { forgetParticipant } = await import('../src/lib/participants.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

async function call(handler, method, path, { body, cookie, code } = {}) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function signUp(name) {
  const res = await register(new Request('http://localhost:3100/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() },
    body: JSON.stringify({ email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' }),
  }))
  assert.equal(res.status, 200)
  return { id: (await res.json()).user.id, cookie: res.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0] }
}

// A fake Upstash REST endpoint: records the pipelined commands and counts INCRs per key, so the limiters behave.
async function fakeUpstash(fn) {
  const cmds = []
  const counters = new Map()
  const server = http.createServer((rq, rs) => {
    let raw = ''
    rq.on('data', (c) => { raw += c })
    rq.on('end', () => {
      const list = JSON.parse(raw)
      cmds.push(...list)
      const out = list.map(([cmd, key]) => ({ result: cmd === 'incr' ? counters.set(key, (counters.get(key) ?? 0) + 1).get(key) : 1 }))
      rs.writeHead(200, { 'content-type': 'application/json' })
      rs.end(JSON.stringify(out))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const saved = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].map((k) => [k, process.env[k]])
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${server.address().port}`
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  try {
    await fn(cmds)
  } finally {
    for (const [k, v] of saved) v === undefined ? delete process.env[k] : (process.env[k] = v)
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
}
const published = (cmds) => cmds.filter((c) => c[0] === 'publish').map((c) => [c[1], JSON.parse(c[2])])

const ann = await signUp('ann')
const bob = await signUp('bob')
async function newBoard(extra = {}) {
  const r = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T', ...extra } })
  assert.equal(r.status, 200)
  return r.data.code
}
const patch = (code, p, extra = {}, cookie = ann.cookie) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie, body: { patch: p, ...extra } })
const NEVER = ['ownerId', 'createdBy', 'passcodeHash', 'ownerKeyHash', ann.id]

test('PATCH publishes a guest-safe board envelope with the owner\'s board id and the tab\'s cid', async () => {
  await fakeUpstash(async (cmds) => {
    const code = await newBoard()
    const r = await patch(code, { title: 'New title', locked: true, passcode: 'letmein!' }, { cid: 'tab-1_A' })
    assert.equal(r.status, 200)
    const [[channel, env], ...more] = published(cmds)
    assert.equal(more.length, 0)
    assert.equal(channel, `kb:${code}`)
    assert.deepEqual([env.t, env.from, env.cid], ['board', publicIdForUser(code, ann.id), 'tab-1_A'])
    assert.deepEqual([env.board.title, env.board.locked, env.board.code, env.board.status, env.board.revoked], ['New title', true, code, 'open', false])
    assert.equal(typeof env.board.updatedAt, 'number')
    const text = cmds.filter((c) => c[0] === 'publish').map((c) => c[2]).join('\n')
    for (const needle of NEVER) assert.ok(!text.includes(needle), `${needle} must not be published`)
    assert.ok(!text.includes('letmein'), 'nor the passcode itself')
  })
})

test('PATCH without a cid publishes without one; an invalid cid is a 400 and nothing changes or goes out', async () => {
  await fakeUpstash(async (cmds) => {
    const code = await newBoard()
    assert.equal((await patch(code, { locked: true })).status, 200)
    assert.ok(!('cid' in published(cmds)[0][1]))
    for (const cid of ['has space', 'x'.repeat(41), '', null, 5, ['a']]) assert.equal((await patch(code, { title: 'Nope' }, { cid })).status, 400, JSON.stringify(cid))
    assert.equal(published(cmds).length, 1)
    assert.equal((await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: ann.cookie })).data.board.title, 'T')
  })
})

test('a refused PATCH (invalid, not the owner, not signed in) publishes nothing; DELETE publishes only {t:deleted}', async () => {
  await fakeUpstash(async (cmds) => {
    const code = await newBoard()
    assert.equal((await patch(code, { nope: 1 })).status, 400)
    assert.equal((await patch(code, { title: 'x' }, {}, bob.cookie)).status, 403)
    assert.equal((await patch(code, { title: 'x' }, {}, '')).status, 401)
    assert.equal(published(cmds).length, 0)
    assert.equal((await call(board.DELETE, 'DELETE', `/api/boards/${code}`, { code, cookie: ann.cookie })).status, 200)
    // ...and a successful DELETE tells open clients so (just the fact, and the owner's public id as sender)
    const out = published(cmds)
    assert.equal(out.length, 1)
    assert.equal(out[0][1].t, 'deleted')
    assert.deepEqual(Object.keys(out[0][1]).sort(), ['from', 't'])
  })
})

test('PATCH works without Redis (nothing to publish to)', async () => {
  const code = await newBoard()
  const r = await patch(code, { status: 'closed' })
  assert.equal(r.status, 200)
  assert.equal(r.data.board.status, 'closed')
})

test('/since returns the guest-safe board next to the items, for guests and owners alike', async () => {
  const code = await newBoard()
  for (const cookie of [undefined, ann.cookie, bob.cookie]) {
    const r = await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code, cookie })
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.data).sort(), ['board', 'items', 'now'])
    assert.equal(r.data.board.code, code)
    for (const k of ['ownerId', 'createdBy', 'passcodeHash']) assert.ok(!(k in r.data.board), k)
  }
  await patch(code, { title: 'Renamed', revoked: false, vote: { active: true, perPerson: 5 } })
  const after = await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code })
  assert.deepEqual([after.data.board.title, after.data.board.vote], ['Renamed', { active: true, perPerson: 5 }])
  assert.ok(!JSON.stringify(after.data).includes(ann.id))
})

// ---- celebrate rate limit (rt/send) ----
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
async function guestOn(code, name = 'Stored Sam') {
  const raw = mintGuest().uid
  const uid = publicId(code, raw)
  await getStore().joinParticipant(code, uid, { kind: 'custom', name, avatar: AV })
  forgetParticipant(code, uid)
  return uid
}
const sendMsg = (code, uid, msg) => send(new Request('http://localhost/api/rt/send', { method: 'POST', body: JSON.stringify({ code, uid, tok: signTok(code, uid), msg }) }))

// The limiter is a fixed window on Date.now(): the tests pin the clock (node's mock timers) to a window edge instead of
// depending on when they happen to run.
const EDGE = () => Math.floor(Date.now() / 3000) * 3000

test('celebrate: one per 3 s per participant (429 Slow down), others are unaffected, other types are not limited', async (t) => {
  await fakeUpstash(async (cmds) => {
    t.mock.timers.enable({ apis: ['Date'], now: EDGE() })
    const code = await newBoard()
    const a = await guestOn(code, 'Alpha One')
    const b = await guestOn(code, 'Beta Two')
    assert.equal((await sendMsg(code, a, { t: 'celebrate', effect: 'confetti' })).status, 200)
    t.mock.timers.setTime(EDGE() + 2999) // still the same window
    const second = await sendMsg(code, a, { t: 'celebrate', effect: 'balloons' })
    assert.equal(second.status, 429)
    assert.equal((await second.json()).error, 'Slow down')
    assert.equal((await sendMsg(code, b, { t: 'celebrate', effect: 'fireworks' })).status, 200, 'another participant has their own budget')
    for (let i = 0; i < 3; i++) assert.equal((await sendMsg(code, a, { t: 'cursor', x: i, y: 1 })).status, 200)
    assert.equal(published(cmds).filter(([, e]) => e.msg.t === 'celebrate').length, 2, 'the refused one was not relayed')
    t.mock.timers.setTime(EDGE() + 3000) // the next window
    assert.equal((await sendMsg(code, a, { t: 'celebrate', effect: 'confetti' })).status, 200)
    t.mock.timers.reset()
  })
})

test('celebrate is limited without Redis too, and an invalid celebrate does not use up the budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: EDGE() })
  const code = await newBoard()
  const a = await guestOn(code, 'Gamma Three')
  assert.equal((await sendMsg(code, a, { t: 'celebrate', effect: 'rain' })).status, 400)
  assert.equal((await sendMsg(code, a, { t: 'celebrate', effect: 'confetti' })).status, 200)
  assert.equal((await sendMsg(code, a, { t: 'celebrate', effect: 'confetti' })).status, 429)
  t.mock.timers.reset()
})

// ---- rev ----
test('rev: the envelope and /since carry it, every PATCH bumps it, item ops do not, and a patch cannot set it', async () => {
  await fakeUpstash(async (cmds) => {
    const code = await newBoard()
    const since = async () => (await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code })).data.board
    assert.equal((await since()).rev, 0)
    assert.equal((await patch(code, { rev: 99 })).status, 400, 'rev is not a setting')
    assert.equal((await since()).rev, 0)
    // two quick PATCHes: two revs, in the envelopes and in /since
    await Promise.all([patch(code, { title: 'A' }), patch(code, { locked: true })])
    assert.deepEqual(published(cmds).map(([, e]) => e.board.rev).sort(), [1, 2])
    assert.equal((await since()).rev, 2)
    // item ops move updatedAt but not rev
    const before = await since()
    const raw = mintGuest().uid
    const uid = publicId(code, raw)
    const persona = { kind: 'custom', name: 'Op Writer', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 } }
    await getStore().joinParticipant(code, uid, persona)
    const note = { op: 'add', item: { id: 'revn1', kind: 'note', x: 1, y: 1, w: 200, h: 200, data: { text: 'x' } } }
    const { validateOp } = await import('../src/lib/validate.js')
    const applied = await getStore().applyOps(code, [validateOp(note).op], { uid, name: persona.name, avatar: persona.avatar, isOwner: true })
    assert.equal(applied.applied.length, 1, JSON.stringify(applied.rejected))
    const after = await since()
    assert.equal(after.rev, before.rev, 'an op write leaves rev alone')
    assert.ok(after.updatedAt >= before.updatedAt)
    assert.equal(published(cmds).length, 2, 'and publishes no board envelope')
  })
})

test('a PATCH drops the cached board: the very next send sees revoked / closed / locked (and the owner is exempt)', async (t) => {
  await fakeUpstash(async (cmds) => {
    t.mock.timers.enable({ apis: ['Date'], now: EDGE() })
    const code = await newBoard()
    const guest = await guestOn(code, 'Cache Guest')
    const ownerId = publicIdForUser(code, ann.id)
    await getStore().joinParticipant(code, ownerId, { kind: 'account', name: 'Olive Owner', avatar: AV })
    forgetParticipant(code, ownerId)
    assert.equal((await sendMsg(code, guest, { t: 'hello' })).status, 200, 'warms the cache with the open board')
    await patch(code, { status: 'closed' })
    assert.equal((await sendMsg(code, guest, { t: 'celebrate', effect: 'confetti' })).status, 403)
    assert.equal((await sendMsg(code, guest, { t: 'cursor', x: 1, y: 1 })).status, 200, 'a closed board still shows cursors')
    await patch(code, { status: 'open', locked: true })
    const locked = await sendMsg(code, guest, { t: 'celebrate', effect: 'confetti' })
    assert.deepEqual([locked.status, (await locked.json()).error], [403, 'Board is read-only'])
    await patch(code, { locked: false, revoked: true })
    for (const msg of [{ t: 'hello' }, { t: 'cursor', x: 1, y: 1 }, { t: 'sel', ids: ['a'] }, { t: 'celebrate', effect: 'confetti' }]) {
      const r = await sendMsg(code, guest, msg)
      assert.deepEqual([r.status, (await r.json()).error], [403, 'This link was revoked'], msg.t)
    }
    const before = published(cmds).length
    assert.equal((await sendMsg(code, ownerId, { t: 'hello' })).status, 200, 'the owner is exempt on a revoked board')
    assert.equal((await sendMsg(code, ownerId, { t: 'celebrate', effect: 'balloons' })).status, 200)
    assert.equal(published(cmds).length, before + 2)
    await patch(code, { status: 'closed', revoked: false })
    t.mock.timers.setTime(EDGE() + 3000)
    assert.equal((await sendMsg(code, ownerId, { t: 'celebrate', effect: 'fireworks' })).status, 200, 'and on a closed board')
    t.mock.timers.reset()
  })
})

test('send refuses a deleted board, and the board cache expires on its own after 5 s', async () => {
  await fakeUpstash(async () => {
    const { cachedBoard, forgetBoard } = await import('../src/lib/boardCache.js')
    const code = await newBoard()
    const store = getStore()
    let reads = 0
    const counting = { getBoard: async (c) => { reads++; return store.getBoard(c) } }
    forgetBoard(code)
    await cachedBoard(counting, code, 1000)
    await cachedBoard(counting, code, 5999)
    assert.equal(reads, 1)
    await cachedBoard(counting, code, 6001)
    assert.equal(reads, 2, 'read again after the TTL')
    assert.equal(await cachedBoard(counting, 'NOPE22', 1), null)
    await cachedBoard(counting, 'NOPE22', 2)
    assert.equal(reads, 4, 'a miss is never cached')
    const guest = await guestOn(code, 'Gone Guest')
    assert.equal((await call(board.DELETE, 'DELETE', `/api/boards/${code}`, { code, cookie: ann.cookie })).status, 200)
    assert.equal((await sendMsg(code, guest, { t: 'hello' })).status, 403, 'nothing to send to')
  })
})
