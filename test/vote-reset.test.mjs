import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const boardRoute = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { POST: resetRoute } = await import('../src/app/api/boards/[code]/votes/reset/route.js')
const { GET: sinceRoute } = await import('../src/app/api/boards/[code]/since/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')
const { mintGuest, publicId, publicIdForUser } = await import('../src/lib/guest.js')
const { getStore } = await import('../src/lib/store.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

async function call(handler, method, path, { body, cookie, code, headers = {} } = {}) {
  const h = { 'x-forwarded-for': fakeIp(), ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

async function signUp(name) {
  const res = await register(new Request('http://localhost:3100/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() },
    body: JSON.stringify({ email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' }),
  }))
  assert.equal(res.status, 200)
  return { id: (await res.json()).user.id, cookie: res.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0] }
}

async function fakeUpstash(fn) {
  const cmds = []
  const counters = new Map()
  const server = http.createServer((rq, rs) => {
    let raw = ''
    rq.on('data', (c) => { raw += c })
    rq.on('end', () => {
      const list = JSON.parse(raw)
      cmds.push(...list)
      rs.writeHead(200, { 'content-type': 'application/json' })
      rs.end(JSON.stringify(list.map(([cmd, key]) => ({ result: cmd === 'incr' ? counters.set(key, (counters.get(key) ?? 0) + 1).get(key) : 1 }))))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const saved = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].map((k) => [k, process.env[k]])
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${server.address().port}`
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  try { await fn(cmds) } finally {
    for (const [k, v] of saved) v === undefined ? delete process.env[k] : (process.env[k] = v)
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
}
const published = (cmds) => cmds.filter((c) => c[0] === 'publish').map((c) => [c[1], JSON.parse(c[2])])

const ann = await signUp('ann')
const bob = await signUp('bob')
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }

async function setup() {
  const made = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T' } })
  const code = made.data.code
  const store = getStore()
  // two guests with a persona each
  const guests = []
  for (const name of ['Gia One', 'Gus Two']) {
    const raw = mintGuest()
    const uid = publicId(code, raw.uid)
    await store.joinParticipant(code, uid, { kind: 'custom', name, avatar: AV })
    guests.push({ uid, cookie: raw.cookie.split(';')[0] })
  }
  const patch = (p) => call(boardRoute.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: p } })
  const ops = (who, list) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: who.cookie, body: { ops: list } })
  const add = (id) => ({ op: 'add', item: { id, kind: 'note', x: 1, y: 1, w: 200, h: 200, data: { text: id } } })
  assert.equal((await patch({ vote: { active: true, perPerson: 3 } })).status, 200)
  assert.equal((await ops(ann, [add('a'), add('b'), add('c')])).status, 200)
  const [g1, g2] = guests
  assert.equal((await ops(g1, [{ op: 'vote', id: 'a' }, { op: 'vote', id: 'b' }])).data.applied.length, 2)
  assert.equal((await ops(g2, [{ op: 'vote', id: 'a' }])).data.applied.length, 1)
  const reset = (who = ann, extra = {}, path = `/api/boards/${code}/votes/reset`) => call(resetRoute, 'POST', path, { code, cookie: who.cookie, body: { ...extra } })
  return { code, g1, g2, ops, patch, reset }
}

test('reset: only the owner; guests, other accounts and anonymous callers are refused and nothing changes', async () => {
  const { code, g1, reset } = await setup()
  assert.equal((await reset(g1)).status, 401, 'a guest has no session')
  assert.equal((await reset({ cookie: undefined })).status, 401)
  assert.equal((await reset(bob)).status, 403, 'another account is not the owner')
  const items = await getStore().listItems(code)
  assert.equal(items.find((i) => i.id === 'a').votes.length, 2)
})

test('reset clears every live item, returns { cleared }, bumps nothing but lastTs, and /since carries the cleared items', async () => {
  const { code, reset } = await setup()
  const store = getStore()
  const before = await store.getBoard(code)
  const r = await reset()
  assert.equal(r.status, 200)
  assert.deepEqual(r.data, { cleared: 2, skipped: 0 })
  const after = await store.getBoard(code)
  assert.equal(after.rev, before.rev, 'rev is for settings only')
  assert.ok(after.lastTs > before.lastTs)
  assert.ok((await store.listItems(code)).every((i) => i.votes.length === 0))
  const since = await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=${before.lastTs}`, { code })
  assert.deepEqual(since.data.items.map((i) => i.id).sort(), ['a', 'b'])
  assert.deepEqual((await reset()).data, { cleared: 0, skipped: 0 }, 'nothing left to clear')
})

test('reset publishes an ops envelope with the changed items, the owner\'s id and the tab\'s cid', async () => {
  await fakeUpstash(async (cmds) => {
    const { code, reset } = await setup()
    cmds.length = 0
    const r = await reset(ann, { cid: 'tab-9_Z' })
    assert.equal(r.status, 200)
    const msgs = published(cmds)
    assert.equal(msgs.length, 1)
    const [channel, env] = msgs[0]
    assert.equal(channel, `kb:${code}`)
    assert.deepEqual([env.t, env.from, env.cid], ['ops', publicIdForUser(code, ann.id), 'tab-9_Z'])
    assert.deepEqual(env.ops.map((i) => [i.id, i.votes]).sort(), [['a', []], ['b', []]])
    assert.ok(env.ops.every((i) => typeof i.updatedAt === 'number'))
    cmds.length = 0
    await reset()
    assert.equal(published(cmds).length, 0, 'nothing changed, nothing published')
  })
})

test('reset is a JSON same-origin POST: a bad cid or a foreign origin is refused; the code is validated', async () => {
  const { code, reset } = await setup()
  assert.equal((await reset(ann, { cid: 'has space' })).status, 400)
  const foreign = await call(resetRoute, 'POST', `/api/boards/${code}/votes/reset`, { code, cookie: ann.cookie, body: {}, headers: { origin: 'https://evil.example' } })
  assert.equal(foreign.status, 403)
  const plain = await resetRoute(new Request(`http://localhost:3100/api/boards/${code}/votes/reset`, { method: 'POST', headers: { cookie: ann.cookie, 'content-type': 'text/plain', 'x-forwarded-for': fakeIp() }, body: '{}' }), { params: Promise.resolve({ code }) })
  assert.ok([400, 415].includes(plain.status))
  assert.equal((await call(resetRoute, 'POST', '/api/boards/NOPE/votes/reset', { code: 'NOPE', cookie: ann.cookie, body: {} })).status, 400)
  assert.equal((await call(resetRoute, 'POST', '/api/boards/ZZZZZZ/votes/reset', { code: 'ZZZZZZ', cookie: ann.cookie, body: {} })).status, 404)
})

test('over HTTP semantics: a vote is refused when voting is stopped, owner included; reset works while stopped', async () => {
  const { g1, ops, patch, reset } = await setup()
  await patch({ vote: { active: false, perPerson: 3 } })
  const guest = await ops(g1, [{ op: 'vote', id: 'c' }])
  assert.deepEqual(guest.data.rejected, [{ id: 'c', error: 'Voting is not open' }])
  const owner = await ops(ann, [{ op: 'vote', id: 'c' }])
  assert.deepEqual(owner.data.rejected, [{ id: 'c', error: 'Voting is not open' }])
  assert.equal((await reset()).data.cleared, 2)
})
