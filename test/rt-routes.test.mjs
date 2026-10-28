import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { GET as stream } from '../src/app/api/rt/stream/route.js'
import { POST as send } from '../src/app/api/rt/send/route.js'
import { POST as ops } from '../src/app/api/boards/[code]/ops/route.js'
import { POST as join } from '../src/app/api/rt/join/route.js'
import { getStore } from '../src/lib/store.js'
import { signTok, verifyTok } from '../src/lib/rt.js'
import { buildAccessCookie } from '../src/lib/access.js'
import { hashPassword } from '../src/lib/password.js'
import { mintGuest, publicId } from '../src/lib/guest.js'
import { forgetParticipant } from '../src/lib/participants.js'
import { forgetBoard } from '../src/lib/boardCache.js'

delete process.env.MONGODB_URI // route handlers use the in-memory store

const CODE = 'ABC234'
const UID = 'KM-2222-3333-4444'
const req = (url, init) => new Request('http://localhost' + url, init)
const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  try { return await fn() } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
}

const OWNER_ID = 'u_0123456789abcdef'
async function ensureBoard(code, extra = {}) {
  const store = getStore()
  await store.deleteBoard(code)
  forgetBoard(code)
  return store.createBoard({ code, type: 'workshop', template: 'blank', title: 'T', ownerId: OWNER_ID, createdBy: OWNER_ID, ...extra })
}
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const STORED = { kind: 'custom', name: 'Stored Sam', avatar: AV }
// A guest browser with a stored persona on `code`: -> { uid, cookie } where uid is the board's PUBLIC id for that
// browser (what the server stores and relays) and cookie is the Cookie header value (which carries the private uid).
async function guestOn(code, persona = STORED) {
  const { uid: raw, cookie } = mintGuest()
  const uid = publicId(code, raw)
  await getStore().joinParticipant(code, uid, persona)
  forgetParticipant(code, uid)
  return { uid, raw, cookie: cookie.split(';')[0] }
}
const REDIS = { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1', UPSTASH_REDIS_REST_TOKEN: 'fake' }

test('stream answers 503 without Redis', async () => {
  await withEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }, async () => {
    const res = await stream(req(`/api/rt/stream?code=${CODE}&uid=${UID}&tok=x`))
    assert.equal(res.status, 503)
    assert.equal(await res.text(), 'realtime not configured')
  })
})

test('stream answers 403 for a bad or missing token and for malformed code/uid', async () => {
  await withEnv({ UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1', UPSTASH_REDIS_REST_TOKEN: 'fake' }, async () => {
    for (const q of [`code=${CODE}&uid=${UID}&tok=bad`, `code=${CODE}&uid=${UID}`, `code=bad&uid=${UID}&tok=${signTok('bad', UID)}`, `code=${CODE}&uid=nope&tok=${signTok(CODE, 'nope')}`]) {
      const res = await stream(req(`/api/rt/stream?${q}`))
      assert.equal(res.status, 403, q)
      assert.equal(await res.text(), 'not in room')
    }
  })
})

test('stream relays only message frames from the board channel, with retry and abort handling', async () => {
  await ensureBoard(CODE)
  const seen = { path: null, auth: null, closed: false }
  const upstream = http.createServer((rq, rs) => {
    seen.path = rq.url
    seen.auth = rq.headers.authorization
    rs.writeHead(200, { 'content-type': 'text/event-stream' })
    rs.write('data: subscribe,kb:ABC234,1\n\n')
    rs.write('data: message,kb:ABC234,{"t":"ops","from":"KM-AAAA-BBBB-CCCC","ops":[]}\n\n')
    rs.write('data: message,kb:ABC234,{"t":"eph","from":"KM-AAAA-BBBB-CCCC","msg":{"t":"cursor","x":1,"y":2}}\n\n')
    rq.on('close', () => { seen.closed = true })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${upstream.address().port}`
  try {
    await withEnv({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'fake-token' }, async () => {
      const ac = new AbortController()
      const res = await stream(new Request(`http://localhost/api/rt/stream?code=${CODE}&uid=${UID}&tok=${signTok(CODE, UID)}`, { signal: ac.signal }))
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/event-stream/)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let text = ''
      while (!text.includes('"cursor"')) {
        const { value, done } = await reader.read()
        if (done) break
        text += dec.decode(value)
      }
      assert.ok(text.startsWith('retry: 1500\n\n'))
      const frames = text.split('\n\n').filter((f) => f.startsWith('data: '))
      assert.deepEqual(frames, [
        'data: {"t":"ops","from":"KM-AAAA-BBBB-CCCC","ops":[]}',
        'data: {"t":"eph","from":"KM-AAAA-BBBB-CCCC","msg":{"t":"cursor","x":1,"y":2}}',
      ])
      assert.equal(seen.path, '/subscribe/kb%3AABC234', 'subscribes to the board channel only')
      assert.equal(seen.auth, 'Bearer fake-token')
      ac.abort()
      await reader.read().catch(() => {})
      for (let i = 0; i < 20 && !seen.closed; i++) await new Promise((r) => setTimeout(r, 25))
      assert.equal(seen.closed, true, 'client abort tears down the upstream request')
    })
  } finally {
    upstream.closeAllConnections?.()
    await new Promise((r) => upstream.close(r))
  }
})

test('send publishes an eph envelope when Redis is present (injected via a fake Upstash REST server)', async () => {
  const cmds = [] // the client pipelines commands: the body is [[cmd, ...args]]
  const upstream = http.createServer((rq, rs) => {
    let body = ''
    rq.on('data', (c) => { body += c })
    rq.on('end', () => { cmds.push(...JSON.parse(body)); rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('[{"result":1}]') })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  try {
    await withEnv({ UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${upstream.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'fake-token' }, async () => {
      await ensureBoard(CODE)
      const { uid } = await guestOn(CODE)
      const res = await send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg: { t: 'cursor', x: 3, y: 4 } }) }))
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { ok: true })
      const pub = cmds.find((c) => c[0] === 'publish')
      assert.deepEqual(pub, ['publish', 'kb:ABC234', JSON.stringify({ t: 'eph', from: uid, msg: { t: 'cursor', x: 3, y: 4, name: 'Stored Sam', avatar: AV } })])
    })
  } finally {
    upstream.closeAllConnections?.()
    await new Promise((r) => upstream.close(r))
  }
})

// A fake Upstash REST endpoint that records pipelined commands.
async function fakeUpstash(fn) {
  const cmds = []
  const server = http.createServer((rq, rs) => {
    let body = ''
    rq.on('data', (c) => { body += c })
    rq.on('end', () => { cmds.push(...JSON.parse(body)); rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('[{"result":1}]') })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await withEnv({ MONGODB_URI: undefined, UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${server.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'fake-token' }, () => fn(cmds))
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
}
const published = (cmds) => cmds.filter((c) => c[0] === 'publish').map((c) => [c[1], JSON.parse(c[2])])

test('send passes the cid through into the eph envelope; envelope has no cid when none was sent', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const { uid } = await guestOn(CODE)
    const post = (extra) => send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg: { t: 'cursor', x: 1, y: 2 }, ...extra }) }))
    assert.equal((await post({ cid: 'tab-1_A' })).status, 200)
    assert.equal((await post({})).status, 200)
    assert.deepEqual(published(cmds), [
      ['kb:ABC234', { t: 'eph', from: uid, cid: 'tab-1_A', msg: { t: 'cursor', x: 1, y: 2, name: 'Stored Sam', avatar: AV } }],
      ['kb:ABC234', { t: 'eph', from: uid, msg: { t: 'cursor', x: 1, y: 2, name: 'Stored Sam', avatar: AV } }],
    ])
  })
})

test('send rejects an invalid cid with 400', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const { uid } = await guestOn(CODE)
    for (const cid of ['has space', 'x'.repeat(41), '', 5, null, ['a']]) {
      const res = await send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, cid, tok: signTok(CODE, uid), msg: { t: 'cursor' } }) }))
      assert.equal(res.status, 400, JSON.stringify(cid))
    }
    assert.equal(published(cmds).length, 0)
  })
})

test('ops passes the cid through into the published ops envelope and rejects an invalid cid', async () => {
  await fakeUpstash(async (cmds) => {
    const code = 'DDDD22'
    await ensureBoard(code)
    const { uid, cookie } = await guestOn(code)
    const params = Promise.resolve({ code })
    const note = (id) => ({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text: 'hi' } } })
    const post = (extra, id) => ops(req(`/api/boards/${code}/ops`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ops: [note(id)], ...extra }) }), { params })

    assert.equal((await post({ cid: 'tab-1_A' }, 'n1')).status, 200)
    assert.equal((await post({}, 'n2')).status, 200)
    const [withCid, without] = published(cmds)
    assert.equal(withCid[0], 'kb:DDDD22')
    assert.deepEqual([withCid[1].t, withCid[1].from, withCid[1].cid, withCid[1].ops.map((i) => i.id)], ['ops', uid, 'tab-1_A', ['n1']])
    assert.deepEqual([without[1].t, without[1].from, 'cid' in without[1], without[1].ops.map((i) => i.id)], ['ops', uid, false, ['n2']])

    for (const cid of ['has space', 'x'.repeat(41), '', null, 5]) assert.equal((await post({ cid }, 'n3')).status, 400, JSON.stringify(cid))
    assert.equal(published(cmds).length, 2)
  })
})

test('stream: a still-valid token does not help once the board is revoked (403), has a passcode (401) or is gone (404)', async () => {
  await withEnv(REDIS, async () => {
    const tok = signTok(CODE, UID)
    const open = (headers) => stream(req(`/api/rt/stream?code=${CODE}&uid=${UID}&tok=${tok}`, { headers }))

    await ensureBoard(CODE, { revoked: true })
    const revoked = await open()
    assert.deepEqual([revoked.status, await revoked.text()], [403, 'This link was revoked'])

    const passcodeHash = await hashPassword('open sesame')
    const board = await ensureBoard(CODE, { passcodeHash })
    const noCookie = await open()
    assert.deepEqual([noCookie.status, await noCookie.text()], [401, 'Passcode required'])
    const wrong = await open({ cookie: `rs_a_${CODE}=${'0'.repeat(64)}` })
    assert.equal(wrong.status, 401)

    await getStore().deleteBoard(CODE)
    const gone = await open()
    assert.deepEqual([gone.status, await gone.text()], [404, 'Board not found'])

    // with the access cookie the connection goes through to the (unreachable) upstream: 502, not an access error
    await ensureBoard(CODE, { passcodeHash })
    const cookie = buildAccessCookie(board.passcodeHash ? board : { code: CODE, passcodeHash }).split(';')[0]
    assert.equal((await open({ cookie })).status, 502)
  })
})

test('stream and send reject an expired or foreign token', async () => {
  await withEnv(REDIS, async () => {
    await ensureBoard(CODE)
    const expired = signTok(CODE, UID, Date.now() - 31 * 60 * 1000)
    assert.equal((await stream(req(`/api/rt/stream?code=${CODE}&uid=${UID}&tok=${expired}`))).status, 403)
    const sendWith = (tok, uid = UID, code = CODE) => send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code, uid, tok, msg: { t: 'cursor', x: 1, y: 1 } }) }))
    const exp = await sendWith(expired)
    assert.deepEqual([exp.status, (await exp.json()).error], [403, 'not in room'])
    assert.equal((await sendWith(signTok(CODE, 'KM-2222-3333-5555'))).status, 403) // a token for another uid
    assert.equal((await sendWith(signTok('ZZZZ22', UID))).status, 403) // a token for another board
    assert.equal((await sendWith('x'.repeat(32))).status, 403) // an old-style bare token
  })
})

test('rt/join issues an expiring token, and refuses revoked and passcode boards like every other read', async () => {
  await withEnv({ ...REDIS, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }, async () => {
    const post = (code, headers = {}) => join(req('/api/rt/join', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers }, body: JSON.stringify({ code, uid: UID }) }))
    await ensureBoard(CODE)
    const { uid, raw, cookie } = await guestOn(CODE)
    const ok = await post(CODE, { cookie })
    assert.equal(ok.status, 200)
    const { tok } = await ok.json()
    assert.equal(verifyTok(CODE, raw, tok), false, 'the token never binds the private cookie uid')
    assert.match(tok, /^\d+\.[0-9a-f]{32}$/)
    assert.ok(verifyTok(CODE, uid, tok), 'the token is for the cookie uid, not the uid in the body')
    assert.equal(verifyTok(CODE, UID, tok), false)
    await ensureBoard(CODE, { revoked: true })
    assert.equal((await post(CODE, { cookie })).status, 403)
    await ensureBoard(CODE, { passcodeHash: await hashPassword('open sesame') })
    assert.equal((await post(CODE, { cookie })).status, 401)
  })
})

// An upstream that sends one frame and then holds the connection open until the other side hangs up.
async function holdingUpstream(fn) {
  const seen = { closed: false, requests: 0 }
  const upstream = http.createServer((rq, rs) => {
    seen.requests++
    rs.writeHead(200, { 'content-type': 'text/event-stream' })
    rs.write('data: message,kb:ABC234,{"t":"ops","from":"KM-AAAA-BBBB-CCCC","ops":[]}\n\n')
    rq.on('close', () => { seen.closed = true })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  try {
    await fn(`http://127.0.0.1:${upstream.address().port}`, seen)
  } finally {
    upstream.closeAllConnections?.()
    await new Promise((r) => upstream.close(r))
  }
}
const endsWithin = async (res, ms) => {
  const reader = res.body.getReader()
  const start = Date.now()
  const timeout = new Promise((r) => setTimeout(() => r('timeout'), ms))
  for (;;) {
    const next = await Promise.race([reader.read(), timeout])
    if (next === 'timeout') return null
    if (next.done) return Date.now() - start
  }
}
const waitClosed = async (seen) => { for (let i = 0; i < 40 && !seen.closed; i++) await new Promise((r) => setTimeout(r, 25)) }

test('stream ends itself after RT_STREAM_MAX_MS and tears down the upstream (the client then reconnects)', async () => {
  await ensureBoard(CODE)
  await holdingUpstream(async (url, seen) => {
    await withEnv({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'fake-token', RT_STREAM_MAX_MS: '50' }, async () => {
      const res = await stream(req(`/api/rt/stream?code=${CODE}&uid=${UID}&tok=${signTok(CODE, UID)}`))
      assert.equal(res.status, 200)
      const took = await endsWithin(res, 3000)
      assert.ok(took !== null, 'the response must end by itself')
      assert.ok(took < 2000, `ended after ${took} ms`)
      await waitClosed(seen)
      assert.equal(seen.closed, true, 'upstream request aborted')
    })
  })
})

test('stream never outlives its membership token, whatever RT_STREAM_MAX_MS says', async () => {
  await ensureBoard(CODE)
  await holdingUpstream(async (url, seen) => {
    await withEnv({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'fake-token', RT_STREAM_MAX_MS: '600000' }, async () => {
      const tok = signTok(CODE, UID, Date.now(), 150) // expires in 150 ms
      const res = await stream(req(`/api/rt/stream?code=${CODE}&uid=${UID}&tok=${tok}`))
      assert.equal(res.status, 200)
      const took = await endsWithin(res, 3000)
      assert.ok(took !== null && took < 2000, `ended after ${took} ms`)
      await waitClosed(seen)
      assert.equal(seen.closed, true)
    })
  })
})

test('stream keeps running when the deadline is far away (default 5 minutes)', async () => {
  await ensureBoard(CODE)
  await holdingUpstream(async (url) => {
    await withEnv({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'fake-token', RT_STREAM_MAX_MS: undefined }, async () => {
      const ac = new AbortController()
      const res = await stream(new Request(`http://localhost/api/rt/stream?code=${CODE}&uid=${UID}&tok=${signTok(CODE, UID)}`, { signal: ac.signal }))
      assert.equal(await endsWithin(res, 300), null, 'still open after 300 ms')
      ac.abort()
    })
  })
})

test('send relays the STORED name and avatar on hello and cursor, whatever the client supplies; other types carry neither', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const { uid } = await guestOn(CODE)
    const post = (msg) => send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg }) }))
    const fake = { name: 'The Real Admin', avatar: { bg: 0, body: 0, eyes: 0, mouth: 0, extra: 0 } }
    assert.equal((await post({ t: 'hello', ...fake })).status, 200)
    assert.equal((await post({ t: 'cursor', x: 1, y: 2, ...fake })).status, 200)
    assert.equal((await post({ t: 'sel', ids: ['a'], ...fake })).status, 200)
    assert.equal((await post({ t: 'typing', name: 'Boss' })).status, 200)
    assert.equal((await post({ t: 'hello' })).status, 200)
    const [hello, cursor, sel, typing, bare] = published(cmds).map(([, env]) => env.msg)
    assert.deepEqual(hello, { t: 'hello', name: 'Stored Sam', avatar: AV })
    assert.deepEqual(cursor, { t: 'cursor', x: 1, y: 2, name: 'Stored Sam', avatar: AV })
    assert.deepEqual(sel, { t: 'sel', ids: ['a'] })
    assert.deepEqual(typing, { t: 'typing' })
    assert.deepEqual(bare, { t: 'hello', name: 'Stored Sam', avatar: AV })
    assert.ok(!JSON.stringify(published(cmds)).includes('The Real Admin') && !JSON.stringify(published(cmds)).includes('Boss'))
  })
})

test('send picks up a changed persona within the cache window, immediately when this process changed it', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const { uid } = await guestOn(CODE)
    const post = () => send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg: { t: 'hello' } }) }))
    await post()
    await getStore().updateParticipant(CODE, uid, { kind: 'custom', name: 'Renamed Sam', avatar: AV })
    forgetParticipant(CODE, uid)
    await post()
    assert.deepEqual(published(cmds).map(([, e]) => e.msg.name), ['Stored Sam', 'Renamed Sam'])
  })
})

test('send refuses a valid token whose holder has no persona on the board (nothing is relayed)', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const uid = mintGuest().uid
    const res = await send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg: { t: 'cursor', x: 1, y: 1 } }) }))
    assert.equal(res.status, 403)
    assert.equal(published(cmds).length, 0)
  })
})

test('send whitelists msg fields per type: a hostile cursor cannot relay a uid, from, name or extra data', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const { uid } = await guestOn(CODE)
    const post = (msg) => send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg }) }))
    const hostile = { t: 'cursor', x: 5, y: 6, uid: 'KM-2222-2222-2222', from: 'KM-3333-3333-3333', name: 'Admin', avatar: 'x', html: '<img onerror=alert(1)>', ids: ['a'], extra: { deep: true } }
    assert.equal((await post(hostile)).status, 200)
    assert.equal((await post({ t: 'hello', uid: 'KM-2222-2222-2222', big: 'x'.repeat(500) })).status, 200)
    assert.equal((await post({ t: 'sel', ids: ['a', 'b'], uid: 'KM-2222-2222-2222', name: 'Admin' })).status, 200)
    assert.equal((await post({ t: 'celebrate', effect: 'fireworks', from: 'x', html: 'y' })).status, 200)
    assert.equal((await post({ t: 'typing', name: 'Boss', x: 1 })).status, 200)
    assert.deepEqual(published(cmds).map(([, e]) => e.msg), [
      { t: 'cursor', x: 5, y: 6, name: 'Stored Sam', avatar: AV },
      { t: 'hello', name: 'Stored Sam', avatar: AV },
      { t: 'sel', ids: ['a', 'b'] },
      { t: 'celebrate', effect: 'fireworks' },
      { t: 'typing' },
    ])
    assert.ok(published(cmds).every(([, e]) => e.from === uid), 'the sender is the token\'s id')
    const text = JSON.stringify(published(cmds))
    for (const needle of ['KM-2222', 'KM-3333', 'Admin', 'Boss', 'onerror']) assert.ok(!text.includes(needle), needle)
  })
})

test('send rejects malformed field values: bad coordinates, oversized selections, unknown effects, unknown types', async () => {
  await fakeUpstash(async (cmds) => {
    await ensureBoard(CODE)
    const { uid } = await guestOn(CODE)
    const post = (msg) => send(req('/api/rt/send', { method: 'POST', body: JSON.stringify({ code: CODE, uid, tok: signTok(CODE, uid), msg }) }))
    const bad = [
      { t: 'cursor' }, { t: 'cursor', x: '1', y: 2 }, { t: 'cursor', x: 1e7, y: 0 }, { t: 'cursor', x: 0, y: -1e6 - 1 }, { t: 'cursor', x: null, y: 1 },
      { t: 'sel' }, { t: 'sel', ids: 'a' }, { t: 'sel', ids: [1] }, { t: 'sel', ids: ['x'.repeat(41)] }, { t: 'sel', ids: Array(101).fill('a') }, { t: 'sel', ids: [''] },
      { t: 'celebrate' }, { t: 'celebrate', effect: 'rain' }, { t: 'celebrate', effect: ['confetti'] },
      { t: 'evil' }, { t: '__proto__' }, { t: 'constructor' }, { x: 1 },
    ]
    for (const m of bad) assert.equal((await post(m)).status, 400, JSON.stringify(m).slice(0, 60))
    assert.equal((await post({ t: 'cursor', x: 1e6, y: -1e6 })).status, 200, 'the limits themselves are fine')
    assert.equal((await post({ t: 'sel', ids: Array(100).fill('x') })).status, 200, '100 short ids fit')
    assert.equal((await post({ t: 'sel', ids: Array(100).fill('x'.repeat(40)) })).status, 413, 'and the 1 KB message cap still applies')
    assert.equal(published(cmds).length, 2, 'only the two valid messages were relayed')
  })
})
