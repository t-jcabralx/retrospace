import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: send } = await import('../src/app/api/rt/send/route.js')
const { signTok } = await import('../src/lib/rt.js')
const { mintGuest, publicId, publicIdForUser } = await import('../src/lib/guest.js')
const { getStore } = await import('../src/lib/store.js')
const { forgetParticipant } = await import('../src/lib/participants.js')
const { forgetBoard } = await import('../src/lib/boardCache.js')
const { windowCount } = await import('../src/lib/http.js')
const { THROW_WINDOW_MS, THROW_BURST } = await import('../src/lib/throwLimit.js')
const { DEFAULT_THROW_EMOJIS } = await import('../src/lib/emoji.js')
const { newCode } = await import('../src/lib/ids.js')

const OWNER_ID = 'u_0123456789abcdef'
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const ON = { enabled: true, emojis: ['🍌', '🗑️', '🍅'] }

async function board(extra = {}) {
  const code = newCode()
  await getStore().createBoard({ code, type: 'workshop', template: 'blank', title: 'T', ownerId: OWNER_ID, createdBy: OWNER_ID, throwables: ON, ...extra })
  forgetBoard(code)
  return code
}
async function guest(code, name) {
  const uid = publicId(code, mintGuest().uid)
  await getStore().joinParticipant(code, uid, { kind: 'custom', name, avatar: AV })
  forgetParticipant(code, uid)
  return uid
}
async function ownerOf(code) {
  const uid = publicIdForUser(code, OWNER_ID)
  await getStore().joinParticipant(code, uid, { kind: 'account', name: 'Olive Owner', avatar: AV })
  forgetParticipant(code, uid)
  return uid
}
const post = (code, uid, msg) => send(new Request('http://localhost/api/rt/send', { method: 'POST', body: JSON.stringify({ code, uid, tok: signTok(code, uid), msg }) }))
const THROW = { t: 'throw', emoji: '🍌', itemId: 'i1', x: 10, y: 20 }
const reason = async (res) => (await res.json()).error

// A fake Upstash that counts INCR and DECR per key, like Redis would, and records everything.
async function fakeUpstash(fn) {
  const cmds = []
  const counters = new Map()
  const server = http.createServer((rq, rs) => {
    let raw = ''
    rq.on('data', (c) => { raw += c })
    rq.on('end', () => {
      const list = JSON.parse(raw)
      cmds.push(...list)
      const out = list.map(([cmd, key]) => {
        const c = String(cmd).toLowerCase()
        if (c === 'incr') return { result: counters.set(key, (counters.get(key) ?? 0) + 1).get(key) }
        if (c === 'decr') return { result: counters.set(key, (counters.get(key) ?? 0) - 1).get(key) }
        if (c === 'get') return { result: counters.get(key) ?? null }
        return { result: 1 }
      })
      rs.writeHead(200, { 'content-type': 'application/json' })
      rs.end(JSON.stringify(out))
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
// The limiter is a fixed window on the clock: pin it to a window edge so a test never straddles one.
const EDGE = () => Math.floor(Date.now() / THROW_WINDOW_MS) * THROW_WINDOW_MS

test('limits: 3 throws per 4.5 s window, which is one per 1.5 s with a burst of 3', () => {
  assert.equal(THROW_BURST, 3)
  assert.equal(THROW_WINDOW_MS, 4500)
})

test('a board without throwables, or with them off, refuses throws with 403', async () => {
  for (const throwables of [undefined, { enabled: false, emojis: ['🍌'] }]) {
    const code = await board({ throwables })
    const g = await guest(code, 'Ann One')
    const res = await post(code, g, THROW)
    assert.equal(res.status, 403)
    assert.equal(await reason(res), 'Throwing is off')
  }
})

test('an emoji that is not in the list is refused, even if it is a valid emoji', async () => {
  const code = await board()
  const g = await guest(code, 'Ann Two')
  const res = await post(code, g, { ...THROW, emoji: '🔥' })
  assert.equal(res.status, 403)
  assert.match(await reason(res), /emoji/i)
  assert.equal((await post(code, g, { ...THROW, emoji: '🗑️' })).status, 200, 'a listed emoji with a variation selector works')
})

test('a revoked board refuses guests; closed and locked refuse non-owners; the owner is exempt from all three', async () => {
  for (const [extra, status, text] of [[{ revoked: true }, 403, /revoked/], [{ status: 'closed' }, 403, /read-only/], [{ locked: true }, 403, /read-only/]]) {
    const code = await board(extra)
    const g = await guest(code, 'Ann Three')
    const res = await post(code, g, THROW)
    assert.equal(res.status, status)
    assert.match(await reason(res), text)
    const o = await ownerOf(code)
    assert.equal((await post(code, o, THROW)).status, 200, JSON.stringify(extra))
  }
  const off = await board({ throwables: { enabled: false, emojis: ['🍌'] } })
  const o = await ownerOf(off)
  assert.equal((await post(off, o, THROW)).status, 403, 'the owner cannot throw while throwing is off')
})

test('a board change takes effect through the board cache invalidation', async () => {
  const code = await board()
  const g = await guest(code, 'Ann Four')
  assert.equal((await post(code, g, THROW)).status, 200)
  await getStore().updateBoard(code, { throwables: { enabled: false, emojis: ['🍌'] } })
  forgetBoard(code)
  assert.equal((await post(code, g, THROW)).status, 403)
})

test('rate limit: a burst of 3 then 429 "Slow down"; others have their own budget; the next window opens again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: EDGE() })
  const code = await board()
  const a = await guest(code, 'Ann Five')
  const b = await guest(code, 'Bob Five')
  for (let i = 0; i < THROW_BURST; i++) assert.equal((await post(code, a, THROW)).status, 200, `throw ${i + 1}`)
  const over = await post(code, a, THROW)
  assert.equal(over.status, 429)
  assert.equal(await reason(over), 'Slow down')
  assert.ok(Number(over.headers.get('retry-after')) >= 1)
  assert.equal((await post(code, b, THROW)).status, 200)
  assert.equal((await post(code, a, { t: 'cursor', x: 1, y: 1 })).status, 200, 'other message types are not affected')
  t.mock.timers.setTime(EDGE() + THROW_WINDOW_MS)
  assert.equal((await post(code, a, THROW)).status, 200)
  t.mock.timers.reset()
})

test('refused throws do not use up the budget (rules refusals and 429s alike)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: EDGE() })
  const code = await board({ throwables: { enabled: false, emojis: ['🍌'] } })
  const a = await guest(code, 'Ann Six')
  for (let i = 0; i < 6; i++) assert.equal((await post(code, a, THROW)).status, 403)
  assert.equal(await windowCount(`throw:${a}`, THROW_WINDOW_MS, { localFallback: true }), 0, 'refused by the rules: nothing counted')
  await getStore().updateBoard(code, { throwables: ON })
  forgetBoard(code)
  for (let i = 0; i < 3; i++) assert.equal((await post(code, a, THROW)).status, 200)
  for (let i = 0; i < 5; i++) assert.equal((await post(code, a, THROW)).status, 429)
  assert.equal(await windowCount(`throw:${a}`, THROW_WINDOW_MS, { localFallback: true }), 3, 'rate-limited tries are given back')
  t.mock.timers.reset()
})

test('malformed throws are 400 and cost nothing: bad emoji, coordinates, itemId', async () => {
  const code = await board()
  const g = await guest(code, 'Ann Seven')
  const bad = [
    { t: 'throw' }, { t: 'throw', emoji: '🍌' }, { t: 'throw', emoji: '🍌', x: 1 }, { t: 'throw', emoji: '', x: 1, y: 1 }, { t: 'throw', emoji: 5, x: 1, y: 1 },
    { t: 'throw', emoji: 'x'.repeat(17), x: 1, y: 1 }, { t: 'throw', emoji: '🍌', x: '1', y: 1 }, { t: 'throw', emoji: '🍌', x: 1e7, y: 0 }, { t: 'throw', emoji: '🍌', x: 0, y: -1e6 - 1 },
    { t: 'throw', emoji: '🍌', x: null, y: 1 }, { t: 'throw', emoji: '🍌', x: 1, y: 1, itemId: 5 }, { t: 'throw', emoji: '🍌', x: 1, y: 1, itemId: '' }, { t: 'throw', emoji: '🍌', x: 1, y: 1, itemId: 'i'.repeat(41) },
  ]
  for (const m of bad) assert.equal((await post(code, g, m)).status, 400, JSON.stringify(m).slice(0, 70))
  assert.equal(await windowCount(`throw:${g}`, THROW_WINDOW_MS, { localFallback: true }), 0)
  assert.equal((await post(code, g, { t: 'throw', emoji: '🍌', x: 1e6, y: -1e6 })).status, 200, 'the limits themselves are fine, and itemId is optional')
})

test('over Redis: the relayed message carries the stored persona, nothing else the client sent, and the sender id', async (t) => {
  await fakeUpstash(async (cmds) => {
    t.mock.timers.enable({ apis: ['Date'], now: EDGE() })
    const code = await board()
    const g = await guest(code, 'Stored Sam')
    const hostile = { ...THROW, uid: 'KM-2222-2222-2222', from: 'KM-3333-3333-3333', name: 'Admin', avatar: 'x', html: '<img onerror=alert(1)>', ids: ['a'] }
    assert.equal((await post(code, g, hostile)).status, 200)
    const [[channel, env], ...more] = published(cmds)
    assert.equal(more.length, 0)
    assert.equal(channel, `kb:${code}`)
    assert.deepEqual(env, { t: 'eph', from: g, msg: { t: 'throw', emoji: '🍌', itemId: 'i1', x: 10, y: 20, name: 'Stored Sam', avatar: AV } })
    const text = JSON.stringify(published(cmds))
    for (const needle of ['KM-2222', 'KM-3333', 'Admin', 'onerror']) assert.ok(!text.includes(needle), needle)
    // 4th within the window: 429, nothing relayed, and the counter went back down
    cmds.length = 0
    for (let i = 0; i < 2; i++) assert.equal((await post(code, g, THROW)).status, 200)
    assert.equal((await post(code, g, THROW)).status, 429)
    assert.equal(published(cmds).length, 2)
    assert.ok(cmds.some((c) => String(c[0]).toLowerCase() === 'decr'), 'the refused try was given back in Redis')
    t.mock.timers.reset()
  })
})

test('a throw from a token holder with no persona is refused; the item id is optional and a point alone is relayed', async () => {
  await fakeUpstash(async (cmds) => {
    const code = await board()
    const stranger = publicId(code, mintGuest().uid)
    assert.equal((await post(code, stranger, THROW)).status, 403)
    const g = await guest(code, 'Point Pat')
    assert.equal((await post(code, g, { t: 'throw', emoji: '🍅', x: -50, y: 7.5 })).status, 200)
    assert.deepEqual(published(cmds).at(-1)[1].msg, { t: 'throw', emoji: '🍅', x: -50, y: 7.5, name: 'Point Pat', avatar: AV })
  })
})

test('the default list is what a new board offers', () => {
  assert.equal(DEFAULT_THROW_EMOJIS.length, 8)
})

test('the list is matched exactly: the VS16-stripped variant of a listed emoji is refused (and the full one is accepted)', async () => {
  const code = await board({ throwables: { enabled: true, emojis: ['🗑️', '❤️'] } })
  const g = await guest(code, 'Ann Eight')
  const bare = await post(code, g, { ...THROW, emoji: '🗑' }) // U+1F5D1 without U+FE0F
  assert.equal(bare.status, 403)
  assert.match(await reason(bare), /list/i)
  assert.equal((await post(code, g, { ...THROW, emoji: '❤' })).status, 403)
  assert.equal((await post(code, g, { ...THROW, emoji: '🗑️' })).status, 200)
})

test('PATCH through the route drops the board cache: a throw is refused at once after throwing is turned off, with no forgetBoard call here', async () => {
  const { POST: register } = await import('../src/app/api/auth/register/route.js')
  const { POST: createBoard } = await import('../src/app/api/boards/route.js')
  const boardRoute = await import('../src/app/api/boards/[code]/route.js')
  const hdr = { 'content-type': 'application/json', 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9` }
  const reg = await register(new Request('http://localhost:3100/api/auth/register', { method: 'POST', headers: hdr, body: JSON.stringify({ email: `cache-${Date.now()}@example.com`, name: 'Cache Owner', password: 'correct horse battery' }) }))
  const cookie = reg.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0]
  const made = await createBoard(new Request('http://localhost:3100/api/boards', { method: 'POST', headers: { ...hdr, cookie }, body: JSON.stringify({ type: 'workshop', template: 'blank', title: 'Cache' }) }))
  const code = (await made.json()).code
  const patch = (p) => boardRoute.PATCH(new Request(`http://localhost:3100/api/boards/${code}`, { method: 'PATCH', headers: { ...hdr, cookie }, body: JSON.stringify({ patch: p }) }), { params: Promise.resolve({ code }) })
  const g = await guest(code, 'Cache Guest')
  assert.equal((await patch({ throwables: { enabled: true, emojis: ['🍌'] } })).status, 200)
  assert.equal((await post(code, g, THROW)).status, 200, 'on: and the board is now in the cache')
  assert.equal((await patch({ throwables: { enabled: false, emojis: ['🍌'] } })).status, 200)
  const off = await post(code, g, THROW)
  assert.equal(off.status, 403)
  assert.equal(await reason(off), 'Throwing is off')
})
