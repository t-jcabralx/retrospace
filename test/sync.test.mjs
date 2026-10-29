import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldApply, createSync } from '../src/client/sync.js'

const ME = 'KM-AAAA-BBBB-CCCC'
const PEER = 'KM-DDDD-EEEE-FFFF'
const identity = { uid: ME }
const doc = (id, updatedAt, extra = {}) => ({ id, kind: 'note', x: 0, y: 0, updatedAt, deleted: false, ...extra })

// --- fakes ---------------------------------------------------------------
function fakeTimers() {
  let now = 0
  let seq = 0
  const pending = new Map()
  return {
    setTimeout: (fn, ms) => { const id = ++seq; pending.set(id, { fn, at: now + ms, every: null }); return id },
    clearTimeout: (id) => void pending.delete(id),
    setInterval: (fn, ms) => { const id = ++seq; pending.set(id, { fn, at: now + ms, every: ms }); return id },
    clearInterval: (id) => void pending.delete(id),
    count: () => pending.size,
    // Move the clock forward, firing due timers in order, letting promises settle between them.
    async advance(ms) {
      const end = now + ms
      for (;;) {
        await settle()
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) break
        const [id, t] = due
        now = Math.max(now, t.at)
        if (t.every) t.at = now + t.every
        else pending.delete(id)
        t.fn()
      }
      now = end
      await settle()
    },
  }
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)) }

class FakeES {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.closed = false
    this.l = {}
    FakeES.instances.push(this)
  }
  addEventListener(type, fn) { (this.l[type] ||= []).push(fn) }
  close() { this.closed = true; this.readyState = 2 }
  emit(type, ev = {}) { for (const fn of this.l[type] || []) fn(ev) }
  open() { this.readyState = 1; this.emit('open') }
  error(closed = false) { this.readyState = closed ? 2 : 0; this.emit('error') }
  message(env) { this.emit('message', { data: typeof env === 'string' ? env : JSON.stringify(env) }) }
}

function harness({ live = true, EventSourceImpl = FakeES, handler } = {}) {
  FakeES.instances = []
  const calls = []
  const timers = fakeTimers()
  const remote = []
  const acks = []
  const eph = []
  const statuses = []
  const rejected = []
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  const fetchImpl = async (url, opts = {}) => {
    const call = { url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined }
    calls.push(call)
    const custom = handler?.(call, res)
    if (custom) return custom instanceof Error ? Promise.reject(custom) : custom
    if (url === '/api/rt/join') return res(200, { tok: 'tok123', live })
    if (url.startsWith('/api/boards/ABC234/since')) return res(200, { items: [], now: 1 })
    if (url === '/api/boards/ABC234/ops') return res(200, { applied: call.body.ops.map((o, i) => doc(o.id, 1000 + i)), rejected: [] })
    if (url === '/api/rt/send') return res(200, { ok: true })
    return res(404, {})
  }
  const mk = (extra = {}) => createSync({
    code: 'ABC234', identity,
    onRemote: (items) => remote.push(items), onAck: (items) => acks.push(items), onEphemeral: (msg, from) => eph.push([msg, from]),
    onStatus: (s) => statuses.push(s), onRejected: (r) => rejected.push(r),
    fetchImpl, EventSourceImpl, timers, sinceOverlapMs: 0, ...extra,
  })
  const urls = (prefix) => calls.filter((c) => c.url.startsWith(prefix))
  return { calls, timers, remote, acks, eph, statuses, rejected, mk, urls, res }
}

// --- shouldApply -----------------------------------------------------------
const SELF = { uid: ME, cid: 'cid-me' }

test('shouldApply drops the own echo (same cid) and malformed envelopes', () => {
  assert.equal(shouldApply({ t: 'ops', from: PEER, cid: 'cid-peer', ops: [] }, SELF), true)
  assert.equal(shouldApply({ t: 'eph', from: PEER, cid: 'cid-peer', msg: { t: 'cursor' } }, SELF), true)
  assert.equal(shouldApply({ t: 'ops', from: ME, cid: 'cid-me', ops: [] }, SELF), false)
  assert.equal(shouldApply({ t: 'eph', from: ME, cid: 'cid-me', msg: {} }, SELF), false)
  for (const bad of [null, undefined, 'x', 5, [], {}, { t: 'ops', ops: [] }, { t: 'ops', from: PEER, ops: 'no' }, { t: 'eph', from: PEER }, { t: 'eph', from: PEER, msg: 'str' }, { t: 'zzz', from: PEER }, { t: 'ops', from: 5, ops: [] }]) {
    assert.equal(shouldApply(bad, SELF), false, JSON.stringify(bad))
  }
})

test('shouldApply applies another tab of the same user (same uid, different cid)', () => {
  assert.equal(shouldApply({ t: 'ops', from: ME, cid: 'cid-other-tab', ops: [] }, SELF), true)
  assert.equal(shouldApply({ t: 'eph', from: ME, cid: 'cid-other-tab', msg: { t: 'cursor' } }, SELF), true)
})

test('shouldApply falls back to comparing uids for an envelope without a cid', () => {
  assert.equal(shouldApply({ t: 'ops', from: ME, ops: [] }, SELF), false)
  assert.equal(shouldApply({ t: 'ops', from: PEER, ops: [] }, SELF), true)
  assert.equal(shouldApply({ t: 'eph', from: ME, msg: { t: 'cursor' } }, SELF), false)
})

// --- join / transport selection --------------------------------------------
test('joins, then opens the stream with code, uid and token and reports live on open', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  assert.deepEqual(h.urls('/api/rt/join')[0].body, { code: 'ABC234' }, 'the server knows the uid from its cookie; the body names only the board')
  assert.equal(FakeES.instances.length, 1)
  assert.equal(FakeES.instances[0].url, `/api/rt/stream?code=ABC234&uid=${ME}&tok=tok123`)
  assert.equal(sync.status(), 'offline')
  FakeES.instances[0].open()
  assert.equal(sync.status(), 'live')
  assert.deepEqual(h.statuses, ['live'])
  sync.close()
})

test('falls back to polling /since every 3 s when join says live:false', async () => {
  const h = harness({ live: false })
  const sync = h.mk({ lastSeen: 70 })
  await settle()
  assert.equal(FakeES.instances.length, 0)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1, 'one immediate poll so status is accurate at once')
  assert.equal(h.urls('/api/boards/ABC234/since')[0].url, '/api/boards/ABC234/since?t=70')
  assert.equal(sync.status(), 'polling')
  await h.timers.advance(2999)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1)
  await h.timers.advance(1)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2)
  await h.timers.advance(6000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 4)
  sync.close()
})

test('watchOnly never joins the room: it polls /since from the start, with no stream and no join', async () => {
  const h = harness()
  const sync = h.mk({ watchOnly: true, lastSeen: 5 })
  await settle()
  assert.equal(h.urls('/api/rt/join').length, 0)
  assert.equal(FakeES.instances.length, 0)
  assert.equal(h.urls('/api/boards/ABC234/since')[0].url, '/api/boards/ABC234/since?t=5')
  assert.equal(sync.status(), 'polling')
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2)
  assert.equal(h.urls('/api/rt/join').length, 0)
  sync.close()
})

test('polls when EventSource is missing even though join says live', async () => {
  const h = harness({ EventSourceImpl: undefined })
  const sync = h.mk({ EventSourceImpl: undefined })
  await settle()
  assert.equal(h.urls('/api/rt/join').length, 1)
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2)
  sync.close()
})

test('polling advances lastSeen so the next poll asks only for newer items, and delivers items', async () => {
  const h = harness({
    live: false,
    handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') && c.url.endsWith('t=0') ? res(200, { items: [doc('a', 55), doc('b', 60)], now: 9 }) : null),
  })
  const sync = h.mk()
  await settle()
  assert.deepEqual(h.remote[0].map((i) => i.id), ['a', 'b'])
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since')[1].url, '/api/boards/ABC234/since?t=60')
  sync.close()
})

test('a stream that is refused twice for good (readyState CLOSED) falls back to polling', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  FakeES.instances[0].error(true)
  await settle()
  assert.equal(FakeES.instances.length, 2, 'one re-join and a second stream first')
  FakeES.instances[1].error(true)
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/rt/join').length, 2, 'no third join')
  assert.equal(h.urls('/api/boards/ABC234/since').length >= 1, true)
  assert.equal(sync.status(), 'polling')
  sync.close()
})

// --- token refresh and access withdrawn -----------------------------------------
const joinReplies = (replies) => {
  let n = 0
  return (c, res) => (c.url === '/api/rt/join' ? res(...(replies[Math.min(n++, replies.length - 1)])) : null)
}

test('after the stream is refused (403) it re-joins for a new token and reopens the stream with it', async () => {
  const h = harness({ handler: joinReplies([[200, { tok: 'tok-1', live: true }], [200, { tok: 'tok-2', live: true }]]) })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  FakeES.instances[0].error(true) // e.g. a reconnect that the server answered with 403
  await settle()
  assert.equal(h.urls('/api/rt/join').length, 2)
  assert.equal(FakeES.instances.length, 2)
  assert.match(FakeES.instances[1].url, /tok=tok-2$/)
  FakeES.instances[1].open()
  assert.equal(sync.status(), 'live')
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await settle()
  assert.equal(h.urls('/api/rt/send')[0].body.tok, 'tok-2')
  sync.close()
})

test('when the re-join is refused too (revoked), polling is denied: status denied, one onDenied, no further traffic', async () => {
  const denials = []
  const h = harness({
    handler: (c, res) => {
      if (c.url === '/api/rt/join') return h.joined++ === 0 ? res(200, { tok: 'tok-1', live: true }) : res(403, { error: 'This link was revoked' })
      if (c.url.startsWith('/api/boards/ABC234/since')) return res(403, { error: 'This link was revoked' })
      return null
    },
  })
  h.joined = 0
  const sync = h.mk({ onDenied: (status, message) => denials.push([status, message]) })
  await settle()
  FakeES.instances[0].open()
  FakeES.instances[0].error(true)
  await settle()
  assert.equal(FakeES.instances.length, 1, 'no new stream')
  assert.deepEqual(denials, [[403, 'This link was revoked']])
  assert.equal(sync.status(), 'denied')
  assert.equal(h.statuses.at(-1), 'denied')
  const joins = h.urls('/api/rt/join').length
  const polls = h.urls('/api/boards/ABC234/since').length
  await h.timers.advance(60_000)
  assert.equal(h.urls('/api/rt/join').length, joins)
  assert.equal(h.urls('/api/boards/ABC234/since').length, polls, 'no polling storm after a denial')
  assert.equal(denials.length, 1)
  sync.close()
})

test('a 401 from /since in polling mode is denied too (Passcode required) and polling stops', async () => {
  const denials = []
  const h = harness({ live: false, handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(401, { error: 'Passcode required' }) : null) })
  const sync = h.mk({ onDenied: (status, message) => denials.push([status, message]) })
  await settle()
  assert.deepEqual(denials, [[401, 'Passcode required']])
  assert.equal(sync.status(), 'denied')
  await h.timers.advance(30_000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1)
  assert.equal(h.timers.count(), 0, 'every timer is cleared')
  sync.close()
})

test('a denied catch-up while the stream is open closes the stream and does not retry', async () => {
  const denials = []
  const h = harness({ handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(403, { error: 'This link was revoked' }) : null) })
  const sync = h.mk({ onDenied: (status) => denials.push(status) })
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(30_000)
  assert.deepEqual(denials, [403])
  assert.equal(FakeES.instances[0].closed, true)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1)
  sync.close()
})

test('a 429 from /since backs polling off for Retry-After seconds, then resumes', async () => {
  let limited = true
  const h = harness({
    live: false,
    handler: (c, res) => {
      if (!c.url.startsWith('/api/boards/ABC234/since') || !limited) return null
      return { ok: false, status: 429, headers: { get: (k) => (k === 'retry-after' ? '30' : null) }, json: async () => ({ error: 'slow down' }) }
    },
  })
  const sync = h.mk()
  await settle()
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1)
  await h.timers.advance(29_999)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1, 'quiet for the whole Retry-After')
  limited = false
  await h.timers.advance(1)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2)
  assert.equal(sync.status(), 'polling')
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 3, 'normal 3 s polling is back')
  sync.close()
})

test('a 429 without Retry-After waits 60 s, and a huge Retry-After is capped at 120 s', async () => {
  for (const [header, waitMs] of [[null, 60_000], ['9999', 120_000]]) {
    const h = harness({
      live: false,
      handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') && h.urls('/api/boards/ABC234/since').length <= 1
        ? { ok: false, status: 429, headers: { get: () => header }, json: async () => ({}) }
        : null),
    })
    const sync = h.mk()
    await settle()
    await h.timers.advance(waitMs - 1)
    assert.equal(h.urls('/api/boards/ABC234/since').length, 1, String(header))
    await h.timers.advance(1)
    assert.equal(h.urls('/api/boards/ABC234/since').length, 2, String(header))
    sync.close()
  }
})

test('a 429 during stream catch-up waits Retry-After instead of the short backoff', async () => {
  let n = 0
  const h = harness({
    handler: (c, res) => {
      if (!c.url.startsWith('/api/boards/ABC234/since')) return null
      return n++ === 0 ? { ok: false, status: 429, headers: { get: () => '20' }, json: async () => ({}) } : null
    },
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(19_999)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1)
  await h.timers.advance(1)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2)
  sync.close()
})

test('the token is refreshed every 20 minutes while connected, and the new one is used for sending', async () => {
  const h = harness({ handler: joinReplies([[200, { tok: 'tok-1', live: true }], [200, { tok: 'tok-2', live: true }], [200, { tok: 'tok-3', live: true }]]) })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(20 * 60_000 - 1)
  assert.equal(h.urls('/api/rt/join').length, 1)
  await h.timers.advance(1)
  assert.equal(h.urls('/api/rt/join').length, 2)
  assert.equal(FakeES.instances.length, 1, 'the open stream is left alone')
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await settle()
  assert.equal(h.urls('/api/rt/send')[0].body.tok, 'tok-2')
  await h.timers.advance(20 * 60_000)
  assert.equal(h.urls('/api/rt/join').length, 3)
  sync.close()
  assert.equal(h.timers.count(), 0, 'close cancels the refresh timer')
})

test('a refresh that is refused (401/403) closes the stream and polls; a network error keeps the stream', async () => {
  const h = harness({ handler: joinReplies([[200, { tok: 'tok-1', live: true }], [500, {}], [403, { error: 'This link was revoked' }]]) })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(20 * 60_000)
  assert.equal(FakeES.instances[0].closed, false, 'a 500 keeps what runs')
  await h.timers.advance(20 * 60_000)
  assert.equal(FakeES.instances[0].closed, true)
  assert.equal(h.urls('/api/boards/ABC234/since').length >= 1, true)
  await h.timers.advance(40 * 60_000)
  assert.equal(h.urls('/api/rt/join').length, 3, 'no more refreshes once polling')
  sync.close()
})

test('a refused /send (403) re-joins once for a new token, not once per message', async () => {
  const h = harness({
    handler: (c, res) => {
      if (c.url === '/api/rt/join') return res(200, { tok: `tok-${++h.joined}`, live: true })
      if (c.url === '/api/rt/send') return res(403, { error: 'not in room' })
      return null
    },
  })
  h.joined = 0
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await h.timers.advance(200)
  assert.equal(h.urls('/api/rt/join').length, 2)
  for (let i = 0; i < 5; i++) { sync.sendEphemeral({ t: 'cursor', x: i, y: i }); await h.timers.advance(70) }
  assert.equal(h.urls('/api/rt/join').length, 2, 'cooldown: still the same single re-join')
  await h.timers.advance(30_000)
  sync.sendEphemeral({ t: 'cursor', x: 9, y: 9 })
  await h.timers.advance(200)
  assert.equal(h.urls('/api/rt/join').length, 3)
  sync.close()
})

// --- stream messages ---------------------------------------------------------
test('applies peer envelopes and IGNORES its own echo', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  const es = FakeES.instances[0]
  es.open()
  es.message({ t: 'ops', from: ME, cid: sync.cid, ops: [doc('mine', 10)] })
  es.message({ t: 'ops', from: PEER, cid: 'cid-peer', ops: [doc('theirs', 20)] })
  es.message({ t: 'eph', from: ME, cid: sync.cid, msg: { t: 'cursor', x: 1 } })
  es.message({ t: 'eph', from: PEER, cid: 'cid-peer', msg: { t: 'cursor', x: 2 } })
  es.message('not json')
  es.message({ t: 'ops', from: PEER, ops: 'bad' })
  assert.deepEqual(h.remote.map((r) => r.map((i) => i.id)), [['theirs']])
  assert.deepEqual(h.eph, [[{ t: 'cursor', x: 2 }, PEER]])
  sync.close()
})

test('every open, the first included, catches up with /since from lastSeen', async () => {
  const h = harness()
  const sync = h.mk({ lastSeen: 100 })
  await settle()
  FakeES.instances[0].open()
  await settle()
  const since = h.urls('/api/boards/ABC234/since')
  assert.equal(since.length, 1)
  assert.equal(since[0].url, '/api/boards/ABC234/since?t=100')
  sync.close()
})

test('first-open catch-up delivers items published before the subscription was active', async () => {
  const h = harness({
    handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: [doc('early', 150)], now: 1 }) : null),
  })
  const sync = h.mk({ lastSeen: 100 })
  await settle()
  FakeES.instances[0].open()
  await settle()
  assert.deepEqual(h.remote.at(-1).map((i) => i.id), ['early'])
  sync.close()
})

test('catches up with /since after an error followed by open, using lastSeen from before the gap', async () => {
  let n = 0
  const h = harness({
    handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: ++n === 1 ? [] : [doc('missed', 300)], now: 400 }) : null),
  })
  const sync = h.mk({ lastSeen: 100 })
  await settle()
  const es = FakeES.instances[0]
  es.open()
  await settle()
  es.message({ t: 'ops', from: PEER, cid: 'cid-peer', ops: [doc('before', 200)] })
  es.error()
  assert.equal(sync.status(), 'offline')
  es.open()
  await settle()
  const since = h.urls('/api/boards/ABC234/since')
  assert.equal(since.length, 2)
  assert.equal(since[1].url, '/api/boards/ABC234/since?t=200')
  assert.deepEqual(h.remote.at(-1).map((i) => i.id), ['missed'])
  assert.equal(sync.status(), 'live')
  sync.close()
})

test('a failed catch-up is retried (500/1500/4000, then every 3 s) until it succeeds and the missed item arrives', async () => {
  let n = 0
  const h = harness({
    handler: (c, res) => {
      if (!c.url.startsWith('/api/boards/ABC234/since')) return null
      n++
      if (n <= 3) return n === 1 ? new Error('network') : res(503, {})
      return res(200, { items: [doc('missed', 300)], now: 1 })
    },
  })
  const sync = h.mk({ lastSeen: 100 })
  await settle()
  FakeES.instances[0].open()
  await settle()
  const count = () => h.urls('/api/boards/ABC234/since').length
  assert.equal(count(), 1)
  assert.equal(h.remote.length, 0)
  await h.timers.advance(499)
  assert.equal(count(), 1)
  await h.timers.advance(1)
  assert.equal(count(), 2)
  await h.timers.advance(1500)
  assert.equal(count(), 3)
  await h.timers.advance(3999)
  assert.equal(count(), 3)
  await h.timers.advance(1)
  assert.equal(count(), 4)
  assert.deepEqual(h.remote.at(-1).map((i) => i.id), ['missed'])
  await h.timers.advance(20000)
  assert.equal(count(), 4, 'stops once it has succeeded')
  sync.close()
})

test('retries keep going every 3 s after the backoff steps while the stream stays open', async () => {
  let ok = false
  const h = harness({
    handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') && !ok ? new Error('network') : null),
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(500 + 1500 + 4000)
  const before = h.urls('/api/boards/ABC234/since').length
  assert.equal(before, 4)
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 5)
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 6)
  ok = true
  await h.timers.advance(3000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 7)
  await h.timers.advance(9000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 7)
  sync.close()
})

test('stream messages during a pending catch-up do not move its cursor past the gap', async () => {
  let n = 0
  const h = harness({
    handler: (c, res) => {
      if (!c.url.startsWith('/api/boards/ABC234/since')) return null
      return ++n <= 2 ? new Error('network') : res(200, { items: [doc('gap-item', 150)], now: 1 })
    },
  })
  const sync = h.mk({ lastSeen: 100 })
  await settle()
  const es = FakeES.instances[0]
  es.open()
  await settle()
  es.message({ t: 'ops', from: PEER, cid: 'cid-peer', ops: [doc('later', 900)] })
  await h.timers.advance(500)
  await h.timers.advance(1500)
  const urls = h.urls('/api/boards/ABC234/since').map((c) => c.url)
  assert.deepEqual(urls, ['/api/boards/ABC234/since?t=100', '/api/boards/ABC234/since?t=100', '/api/boards/ABC234/since?t=100'])
  assert.deepEqual(h.remote.map((r) => r.map((i) => i.id)), [['later'], ['gap-item']])
  // once the catch-up has succeeded the cursor is the real lastSeen again
  es.error()
  es.open()
  await settle()
  assert.equal(h.urls('/api/boards/ABC234/since').at(-1).url, '/api/boards/ABC234/since?t=900')
  sync.close()
})

test('a catch-up requested while one is in flight is queued, not dropped', async () => {
  const gates = []
  const h = harness({
    handler: (c, res) => {
      if (!c.url.startsWith('/api/boards/ABC234/since')) return null
      const i = gates.length
      return new Promise((resolve) => gates.push(() => resolve(res(200, { items: [doc(`r${i}`, 200 + i)], now: 1 }))))
    },
  })
  const sync = h.mk({ lastSeen: 100 })
  await settle()
  const es = FakeES.instances[0]
  es.open() // catch-up #1 starts and hangs
  await settle()
  es.error()
  es.open() // asked again while #1 is still in flight
  es.error()
  es.open() // and again: still exactly one follow-up
  await settle()
  assert.equal(h.urls('/api/boards/ABC234/since').length, 1)
  gates[0]()
  await settle()
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2, 'one follow-up round')
  assert.equal(h.urls('/api/boards/ABC234/since')[1].url, '/api/boards/ABC234/since?t=100', 'still from the gap floor')
  gates[1]()
  await settle()
  assert.equal(h.urls('/api/boards/ABC234/since').length, 2)
  assert.deepEqual(h.remote.map((r) => r[0].id), ['r0', 'r1'])
  sync.close()
})

// --- tabs of one browser -------------------------------------------------------
test('two syncs with the same uid but different cids apply each other\'s envelopes; own echo is dropped', async () => {
  const h = harness()
  const a = h.mk({ cid: 'cid-tab-a' })
  const b = h.mk({ cid: 'cid-tab-b' })
  await settle()
  const [esA, esB] = FakeES.instances
  esA.open()
  esB.open()
  await settle()
  assert.notEqual(a.cid, b.cid)
  const fromA = { t: 'ops', from: ME, cid: a.cid, ops: [doc('x', 500)] }
  esA.message(fromA)
  esB.message(fromA)
  assert.equal(h.remote.filter((r) => r[0].id === 'x').length, 1, 'only tab B applies tab A\'s ops')
  const cursorA = { t: 'eph', from: ME, cid: a.cid, msg: { t: 'cursor', x: 1 } }
  esA.message(cursorA)
  esB.message(cursorA)
  assert.deepEqual(h.eph, [[{ t: 'cursor', x: 1 }, ME]])
  a.close()
  b.close()
})

test('each createSync has its own random cid, and it is sent with ops and ephemeral messages', async () => {
  const h = harness()
  const a = h.mk()
  const b = h.mk()
  await settle()
  assert.match(a.cid, /^[\w-]{12,40}$/)
  assert.notEqual(a.cid, b.cid)
  FakeES.instances[0].open()
  a.send([{ op: 'delete', id: 'z' }])
  a.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await h.timers.advance(100)
  assert.equal(h.urls('/api/boards/ABC234/ops')[0].body.cid, a.cid)
  assert.equal(h.urls('/api/rt/send')[0].body.cid, a.cid)
  a.close()
  b.close()
})

// --- acks -------------------------------------------------------------------------
test('the author\'s own applied docs go to onAck, not onRemote', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await settle()
  const remoteBefore = h.remote.length
  sync.send([{ op: 'add', id: 'a', item: { id: 'a' } }, { op: 'delete', id: 'b' }])
  await h.timers.advance(50)
  assert.deepEqual(h.acks.map((r) => r.map((i) => i.id)), [['a', 'b']])
  assert.equal(h.remote.length, remoteBefore)
  sync.close()
})

// --- sending ops -------------------------------------------------------------
test('batches ops sent within 50 ms into one POST and hands the applied docs to onAck', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.send([{ op: 'add', id: 'a', item: { id: 'a' } }])
  await h.timers.advance(20)
  sync.send([{ op: 'update', id: 'a', patch: { x: 1 } }, { op: 'delete', id: 'b' }])
  await h.timers.advance(29)
  assert.equal(h.urls('/api/boards/ABC234/ops').length, 0)
  await h.timers.advance(1)
  const posts = h.urls('/api/boards/ABC234/ops')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].method, 'POST')
  assert.deepEqual(Object.keys(posts[0].body).sort(), ['cid', 'ops'], 'no uid or name in the ops body: the server uses its cookie and the stored persona')
  assert.equal('ownerKey' in posts[0].body, false)
  assert.deepEqual(posts[0].body.ops.map((o) => o.op), ['add', 'update', 'delete'])
    sync.close()
})

test('splits more than 50 queued ops into sequential batches', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.send(Array.from({ length: 120 }, (_, i) => ({ op: 'delete', id: `i${i}` })))
  await h.timers.advance(50)
  await h.timers.advance(50)
  await h.timers.advance(50)
  const posts = h.urls('/api/boards/ABC234/ops')
  assert.deepEqual(posts.map((p) => p.body.ops.length), [50, 50, 20])
  sync.close()
})

test('reports server rejections through onRejected', async () => {
  const h = harness({
    handler: (c, res) => (c.url === '/api/boards/ABC234/ops' ? res(200, { applied: [], rejected: [{ id: 'a', error: 'Board is locked' }] }) : null),
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.send([{ op: 'delete', id: 'a' }])
  await h.timers.advance(50)
  assert.deepEqual(h.rejected, [[{ id: 'a', error: 'Board is locked' }]])
  sync.close()
})

test('retries a failed batch 3 times (500/1500/4000 ms) then goes offline with the batch kept', async () => {
  let fail = true
  const h = harness({
    handler: (c, res) => (c.url === '/api/boards/ABC234/ops' && fail ? res(503, { error: 'down' }) : null),
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  assert.equal(sync.status(), 'live')
  sync.send([{ op: 'delete', id: 'a' }])
  const n = () => h.urls('/api/boards/ABC234/ops').length
  await h.timers.advance(50)
  assert.equal(n(), 1)
  await h.timers.advance(499)
  assert.equal(n(), 1)
  await h.timers.advance(1)
  assert.equal(n(), 2)
  await h.timers.advance(1499)
  assert.equal(n(), 2)
  await h.timers.advance(1)
  assert.equal(n(), 3)
  await h.timers.advance(3999)
  assert.equal(n(), 3)
  assert.equal(sync.status(), 'live')
  await h.timers.advance(1)
  assert.equal(n(), 4)
  assert.equal(sync.status(), 'offline')
  await h.timers.advance(4999)
  assert.equal(n(), 4)
  // Nothing has to happen for it to recover: the kept batch is asked for again after 5 s.
  fail = false
  await h.timers.advance(1)
  assert.equal(n(), 5)
  assert.deepEqual(h.urls('/api/boards/ABC234/ops')[4].body.ops, [{ op: 'delete', id: 'a' }])
  assert.equal(sync.status(), 'live')
  sync.close()
})

test('a long outage keeps asking by itself, 5 s then 10 s then 20 s then every 30 s, and a stream reopening sends the batch at once', async () => {
  let fail = true
  const h = harness({
    handler: (c, res) => (c.url === '/api/boards/ABC234/ops' && fail ? res(503, { error: 'down' }) : null),
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.send([{ op: 'delete', id: 'a' }])
  const n = () => h.urls('/api/boards/ABC234/ops').length
  await h.timers.advance(50 + 500 + 1500 + 4000)
  assert.equal(n(), 4)
  for (const wait of [5000, 10000, 20000, 30000, 30000]) {
    const before = n()
    await h.timers.advance(wait - 1)
    assert.equal(n(), before, `no attempt before ${wait} ms`)
    await h.timers.advance(1)
    assert.equal(n(), before + 1, `an attempt after ${wait} ms`)
    await h.timers.advance(500 + 1500 + 4000)
    assert.equal(n(), before + 4)
  }
  assert.equal(sync.status(), 'offline')
  fail = false
  const es = FakeES.instances[0]
  es.error()
  es.open()
  await h.timers.advance(50)
  assert.deepEqual(h.urls('/api/boards/ABC234/ops').at(-1).body.ops, [{ op: 'delete', id: 'a' }], 'the kept batch went out when the stream came back')
  assert.equal(sync.status(), 'live')
  sync.close()
  const after = n()
  await h.timers.advance(120000)
  assert.equal(n(), after, 'closing stops the retries')
})

test('a new send while offline retries the kept queue, in order', async () => {
  let fail = true
  const h = harness({
    handler: (c, res) => (c.url === '/api/boards/ABC234/ops' && fail ? new Error('network') : null),
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.send([{ op: 'delete', id: 'a' }])
  await h.timers.advance(50 + 500 + 1500 + 4000)
  assert.equal(sync.status(), 'offline')
  fail = false
  sync.send([{ op: 'delete', id: 'b' }])
  await h.timers.advance(50)
  const posts = h.urls('/api/boards/ABC234/ops')
  assert.deepEqual(posts.at(-1).body.ops.map((o) => o.id), ['a', 'b'])
  assert.equal(sync.status(), 'live')
  sync.close()
})

test('a permanent 4xx drops the batch (no retry) and reports it', async () => {
  const h = harness({
    handler: (c, res) => (c.url === '/api/boards/ABC234/ops' ? res(400, { error: 'ops must be 1..50' }) : null),
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.send([{ op: 'delete', id: 'a' }])
  await h.timers.advance(10000)
  assert.equal(h.urls('/api/boards/ABC234/ops').length, 1)
  assert.deepEqual(h.rejected, [[{ id: 'a', error: 'ops must be 1..50' }]])
  assert.equal(sync.status(), 'live')
  sync.close()
})

// --- ephemeral -----------------------------------------------------------------
test('sendEphemeral posts to /api/rt/send, throttled to ~15/s, keeping the latest cursor', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await settle()
  const sent = () => h.urls('/api/rt/send')
  assert.equal(sent().length, 1)
  assert.deepEqual(sent()[0].body, { code: 'ABC234', uid: ME, cid: sync.cid, tok: 'tok123', msg: { t: 'cursor', x: 1, y: 1 } })
  for (let i = 2; i <= 10; i++) sync.sendEphemeral({ t: 'cursor', x: i, y: i })
  await settle()
  assert.equal(sent().length, 1, 'extras within the window are held back')
  await h.timers.advance(67)
  assert.equal(sent().length, 2)
  assert.deepEqual(sent()[1].body.msg, { t: 'cursor', x: 10, y: 10 }, 'only the latest cursor survives')
  // Over one second no more than 15 go out, however many are offered.
  const before = sent().length
  for (let ms = 0; ms < 1000; ms += 10) {
    sync.sendEphemeral({ t: 'cursor', x: ms, y: ms })
    await h.timers.advance(10)
  }
  assert.ok(sent().length - before <= 15, `sent ${sent().length - before}`)
  assert.ok(sent().length - before >= 10)
  sync.close()
})

test('a non-cursor ephemeral is not overwritten by later cursors', async () => {
  const h = harness()
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  sync.sendEphemeral({ t: 'celebrate', emoji: 'x' })
  sync.sendEphemeral({ t: 'cursor', x: 2, y: 2 })
  await h.timers.advance(300)
  const types = h.urls('/api/rt/send').map((c) => c.body.msg.t)
  assert.deepEqual(types, ['cursor', 'celebrate', 'cursor'])
  sync.close()
})

test('sendEphemeral does nothing when not live', async () => {
  const h = harness({ live: false })
  const sync = h.mk()
  await settle()
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await h.timers.advance(500)
  assert.equal(h.urls('/api/rt/send').length, 0)
  sync.close()
})

// --- close ---------------------------------------------------------------------
test('close stops the stream, polling and pending work', async () => {
  const h = harness({ live: false })
  const sync = h.mk()
  await settle()
  const polled = h.urls('/api/boards/ABC234/since').length
  sync.send([{ op: 'delete', id: 'a' }])
  sync.close()
  await h.timers.advance(10000)
  assert.equal(h.urls('/api/boards/ABC234/ops').length, 0)
  assert.equal(h.urls('/api/boards/ABC234/since').length, polled)
  assert.equal(h.timers.count(), 0)

  const h2 = harness()
  const s2 = h2.mk()
  await settle()
  s2.close()
  assert.equal(FakeES.instances[0].closed, true)
})

test('closing before join resolves opens no stream', async () => {
  const h = harness()
  const sync = h.mk()
  sync.close()
  await settle()
  assert.equal(FakeES.instances.length, 0)
})

test('module imports cleanly and createSync touches no browser global until called', () => {
  assert.equal(typeof createSync, 'function')
  assert.equal(typeof globalThis.EventSource, 'undefined')
})

test('stream refused during an in-flight token refresh still ends with a live stream', async () => {
  let release
  const h = harness({
    handler: (c, res) => {
      if (c.url !== '/api/rt/join') return null
      h.joined = (h.joined ?? 0) + 1
      if (h.joined === 1) return res(200, { tok: 'tok-1', live: true })
      return new Promise((r) => { release = () => r(res(200, { tok: 'tok-2', live: true })) })
    },
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(20 * 60_000) // the refresh starts and its join stays pending
  assert.equal(h.urls('/api/rt/join').length, 2)
  FakeES.instances[0].error(true) // the stream is refused meanwhile: rejoin() must not just vanish
  await settle()
  assert.equal(FakeES.instances.length, 1)
  release()
  await settle()
  assert.equal(FakeES.instances.length, 2, 'the refresh reopened the stream')
  assert.match(FakeES.instances[1].url, /tok=tok-2$/)
  FakeES.instances[1].open()
  assert.equal(sync.status(), 'live')
  sync.close()
})

test('stream refused during an in-flight refresh that then fails ends up polling', async () => {
  let release
  const h = harness({
    handler: (c, res) => {
      if (c.url !== '/api/rt/join') return null
      h.joined = (h.joined ?? 0) + 1
      if (h.joined === 1) return res(200, { tok: 'tok-1', live: true })
      return new Promise((r) => { release = () => r(res(500, {})) })
    },
  })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await h.timers.advance(20 * 60_000)
  FakeES.instances[0].error(true)
  await settle()
  release()
  await settle()
  assert.equal(FakeES.instances.length, 1)
  assert.equal(h.urls('/api/boards/ABC234/since').length >= 1, true, 'fell back to polling')
  await h.timers.advance(3000)
  assert.equal(sync.status(), 'polling')
  sync.close()
})

test('a denial that lands while a re-join is in flight stops it: no new stream is opened afterwards', async () => {
  let releaseSince
  let releaseJoin
  const h = harness({
    handler: (c, res) => {
      if (c.url === '/api/rt/join') {
        h.joined = (h.joined ?? 0) + 1
        return h.joined === 1 ? res(200, { tok: 'tok-1', live: true }) : new Promise((r) => { releaseJoin = () => r(res(200, { tok: 'tok-2', live: true })) })
      }
      if (c.url.startsWith('/api/boards/ABC234/since')) {
        h.sinceCalls = (h.sinceCalls ?? 0) + 1
        return h.sinceCalls === 1 ? res(200, { items: [], now: 1 }) : new Promise((r) => { releaseSince = () => r(res(403, { error: 'This link was revoked' })) })
      }
      return null
    },
  })
  const denials = []
  const sync = h.mk({ onDenied: (status) => denials.push(status) })
  await settle()
  FakeES.instances[0].open()
  await settle()
  FakeES.instances[0].error(false) // a hiccup: the next open owes a catch-up
  FakeES.instances[0].open()
  await settle()
  assert.equal(typeof releaseSince, 'function', 'the catch-up is in flight')
  FakeES.instances[0].error(true) // refused: rejoin() starts and its join stays pending
  await settle()
  assert.equal(h.urls('/api/rt/join').length, 2)
  releaseSince() // the catch-up says 403: access is gone
  await settle()
  assert.deepEqual(denials, [403])
  releaseJoin() // the join answers 200 afterwards
  await settle()
  assert.equal(FakeES.instances.length, 1, 'rejoin() noticed the denial and did not reopen the stream')
  assert.equal(sync.status(), 'denied')
  sync.close()
})

// --- board settings (t:'board' on the stream, `board` in /since) ---------------------------------------
const boardAt = (updatedAt, extra = {}) => ({ code: 'ABC234', title: 'T', locked: false, updatedAt, ...extra })

test('shouldApply accepts a board envelope (not our own echo) and rejects one without a board', () => {
  assert.equal(shouldApply({ t: 'board', from: PEER, cid: 'cid-peer', board: boardAt(5) }, SELF), true)
  assert.equal(shouldApply({ t: 'board', from: ME, cid: 'cid-other-tab', board: boardAt(5) }, SELF), true)
  assert.equal(shouldApply({ t: 'board', from: ME, cid: 'cid-me', board: boardAt(5) }, SELF), false)
  for (const bad of [{ t: 'board', from: PEER }, { t: 'board', from: PEER, board: 'x' }, { t: 'board', from: PEER, board: [] }, { t: 'board', board: boardAt(1) }]) {
    assert.equal(shouldApply(bad, SELF), false, JSON.stringify(bad))
  }
})

test('a board envelope on the stream goes to onBoard once per updatedAt, never to onRemote or onEphemeral', async () => {
  const h = harness()
  const boards = []
  const sync = h.mk({ onBoard: (b) => boards.push(b), boardAt: 10 })
  await settle()
  const es = FakeES.instances[0]
  es.open()
  es.message({ t: 'board', from: PEER, cid: 'c-peer', board: boardAt(20, { locked: true }) })
  es.message({ t: 'board', from: PEER, cid: 'c-peer', board: boardAt(20, { locked: true }) })
  es.message({ t: 'board', from: PEER, cid: 'c-peer', board: boardAt(15) })
  es.message({ t: 'board', from: PEER, cid: 'c-peer', board: boardAt(30, { status: 'closed' }) })
  es.message({ t: 'board', from: ME, cid: sync.cid, board: boardAt(40) })
  es.message({ t: 'board', from: PEER, board: 'nope' })
  assert.deepEqual(boards.map((b) => b.updatedAt), [20, 30])
  assert.deepEqual([h.remote.length, h.eph.length], [0, 0])
  sync.close()
})

test('ephemeral messages carry the sender and the tab (cid) to onEphemeral', async () => {
  const h = harness()
  const got = []
  const sync = h.mk({ onEphemeral: (...a) => got.push(a) })
  await settle()
  const es = FakeES.instances[0]
  es.open()
  es.message({ t: 'eph', from: PEER, cid: 'c-peer', msg: { t: 'hello', name: 'N' } })
  es.message({ t: 'eph', from: PEER, msg: { t: 'sel', ids: [] } })
  assert.deepEqual(got, [[{ t: 'hello', name: 'N' }, PEER, 'c-peer'], [{ t: 'sel', ids: [] }, PEER, undefined]])
  sync.close()
})

test('polling delivers a changed board once: not for the one already shown, not again until updatedAt moves', async () => {
  let current = boardAt(10)
  const h = harness({
    live: false,
    handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: [], board: current, now: 1 }) : null),
  })
  const boards = []
  const sync = h.mk({ onBoard: (b) => boards.push(b), boardAt: 10 })
  await settle()
  assert.equal(boards.length, 0, 'the first poll sees the board the host already has')
  current = boardAt(25, { locked: true })
  await h.timers.advance(3000)
  await h.timers.advance(3000)
  assert.deepEqual(boards.map((b) => [b.updatedAt, b.locked]), [[25, true]], 'delivered once, however many polls see it')
  current = boardAt(26, { revoked: true })
  await h.timers.advance(3000)
  assert.deepEqual(boards.map((b) => b.updatedAt), [25, 26])
  sync.close()
})

test('a /since without a board (older server) or with a malformed one changes nothing; without boardAt the first board is delivered', async () => {
  let reply = { items: [], now: 1 }
  const h = harness({ live: false, handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, reply) : null) })
  const boards = []
  const sync = h.mk({ onBoard: (b) => boards.push(b) })
  await settle()
  reply = { items: [], board: 'x', now: 1 }
  await h.timers.advance(3000)
  reply = { items: [], board: { title: 'no stamp' }, now: 1 }
  await h.timers.advance(3000)
  assert.equal(boards.length, 0)
  reply = { items: [], board: boardAt(7), now: 1 }
  await h.timers.advance(3000)
  assert.deepEqual(boards.map((b) => b.updatedAt), [7])
  sync.close()
})

test('the catch-up /since after a stream opens also delivers a board change it missed', async () => {
  const h = harness({ handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: [], board: boardAt(99, { status: 'closed' }), now: 1 }) : null) })
  const boards = []
  const sync = h.mk({ onBoard: (b) => boards.push(b), boardAt: 50 })
  await settle()
  FakeES.instances[0].open()
  await settle()
  assert.deepEqual(boards.map((b) => [b.updatedAt, b.status]), [[99, 'closed']])
  sync.close()
})

// --- board settings ordered by rev ---------------------------------------------------------------------
test('rev decides what is new: a lower updatedAt with a higher rev is delivered, the same rev again is not, op-driven updatedAt noise never is', async () => {
  let current = boardAt(1000, { rev: 2 })
  const h = harness({ live: false, handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: [], board: current, now: 1 }) : null) })
  const boards = []
  const sync = h.mk({ onBoard: (b) => boards.push(b), boardRev: 2, boardAt: 1000 })
  await settle()
  current = boardAt(1500, { rev: 2 }) // item ops pushed updatedAt up; no settings change
  await h.timers.advance(3000)
  current = boardAt(1900, { rev: 2 })
  await h.timers.advance(3000)
  assert.equal(boards.length, 0, 'busy polling clients are not re-rendered by op noise')
  current = boardAt(10, { rev: 3, locked: true }) // a PATCH stamped by a slower clock
  await h.timers.advance(3000)
  await h.timers.advance(3000)
  assert.deepEqual(boards.map((b) => [b.rev, b.locked]), [[3, true]], 'delivered once')
  current = boardAt(10, { rev: 4, status: 'closed' }) // two changes in the same ms are two revs
  await h.timers.advance(3000)
  assert.deepEqual(boards.map((b) => b.rev), [3, 4])
  sync.close()
})

test('the stream delivers by rev too: a lower-updatedAt change applies, duplicates and older revs do not; no baseline rev counts as 0', async () => {
  const h = harness()
  const boards = []
  const sync = h.mk({ onBoard: (b) => boards.push(b), boardAt: 5000 }) // a board that never changed: no rev
  await settle()
  const es = FakeES.instances[0]
  es.open()
  es.message({ t: 'board', from: PEER, cid: 'c', board: boardAt(100, { rev: 1 }) })
  es.message({ t: 'board', from: PEER, cid: 'c', board: boardAt(9000, { rev: 1 }) })
  es.message({ t: 'board', from: PEER, cid: 'c', board: boardAt(100, { rev: 2 }) })
  es.message({ t: 'board', from: PEER, cid: 'c', board: boardAt(50, { rev: 1 }) })
  assert.deepEqual(boards.map((b) => b.rev), [1, 2])
  sync.close()
})

test('onClock reports the server clock from /since replies, with when the request left and came back', async () => {
  const clocks = []
  const h = harness({ live: false, handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: [], now: 123_456 }) : null) })
  const sync = h.mk({ onClock: (...a) => clocks.push(a) })
  await settle()
  assert.equal(clocks.length, 1)
  const [serverNow, sentAt, receivedAt] = clocks[0]
  assert.equal(serverNow, 123_456)
  assert.ok(Number.isFinite(sentAt) && receivedAt >= sentAt)
  await h.timers.advance(3000)
  assert.equal(clocks.length, 2, 'every poll refreshes it')
  sync.close()
})

test('onClock is not called for a reply without a numeric now', async () => {
  const clocks = []
  const h = harness({ live: false, handler: (c, res) => (c.url.startsWith('/api/boards/ABC234/since') ? res(200, { items: [], now: 'soon' }) : null) })
  const sync = h.mk({ onClock: (...a) => clocks.push(a) })
  await settle()
  assert.deepEqual(clocks, [])
  sync.close()
})

test('sendEphemeral reports the server\'s answer to its callback: status and the error text of a refusal', async () => {
  const answers = []
  const h = harness({ handler: (c, res) => (c.url === '/api/rt/send' && c.body.msg.t === 'throw' ? res(403, { error: 'Throwing is off' }) : null) })
  const sync = h.mk()
  await settle()
  FakeES.instances[0].open()
  await settle()
  sync.sendEphemeral({ t: 'throw', emoji: '🍌', x: 1, y: 2 }, (status, error) => answers.push([status, error]))
  sync.sendEphemeral({ t: 'hello' }, (status, error) => answers.push(['hello', status, error]))
  await settle()
  await h.timers.advance(100)
  await settle()
  assert.deepEqual(answers.sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [[403, 'Throwing is off'], ['hello', 200, undefined]])
  sync.close()
})
