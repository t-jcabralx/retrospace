import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldApply, createSync } from '../src/client/sync.js'
import { createPoller } from '../src/ui/revealPoller.js'

const ME = 'KM-AAAA-BBBB-CCCC'
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)) }

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
    now: () => now,
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

class FakeES {
  static instances = []
  constructor(url) { this.url = url; this.readyState = 0; this.l = {}; FakeES.instances.push(this) }
  addEventListener(type, fn) { (this.l[type] ||= []).push(fn) }
  close() { this.readyState = 2 }
  emit(type, ev = {}) { for (const fn of this.l[type] || []) fn(ev) }
  open() { this.readyState = 1; this.emit('open') }
  message(env) { this.emit('message', { data: JSON.stringify(env) }) }
}

function setup(handler, extra = {}) {
  FakeES.instances = []
  const calls = []
  const timers = fakeTimers()
  const denied = []
  const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } })
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' })
    return handler(url, res) ?? res(404, {})
  }
  const sync = createSync({ code: 'ABC234', identity: { uid: ME }, fetchImpl, EventSourceImpl: FakeES, timers, onDenied: (s, m) => denied.push([s, m]), ...extra })
  const urls = (p) => calls.filter((c) => c.url.startsWith(p))
  return { sync, timers, calls, denied, urls, res }
}

test('a 404 from /since is terminal: the client reports "Board not found" and stops polling', async () => {
  const h = setup((url, res) => (url === '/api/rt/join' ? res(200, { tok: 't', live: false }) : res(404, { error: 'Board not found' })))
  await settle()
  assert.deepEqual(h.denied, [[404, 'Board not found']])
  const before = h.urls('/api/boards/ABC234/since').length
  await h.timers.advance(30_000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, before, 'no further polls of a deleted board')
  assert.equal(h.sync.status(), 'denied')
  h.sync.close()
})

test('a 404 from /api/rt/join is terminal too (no polling, no rejoin)', async () => {
  const h = setup((url, res) => (url === '/api/rt/join' ? res(404, { error: 'Board not found' }) : res(200, { items: [], now: 1 })))
  await settle()
  assert.deepEqual(h.denied, [[404, 'Board not found']])
  await h.timers.advance(30_000)
  assert.equal(h.urls('/api/boards/ABC234/since').length, 0)
  assert.equal(h.urls('/api/rt/join').length, 1)
  h.sync.close()
})

test('a {t:"deleted"} envelope from the stream ends the session as "Board not found"', async () => {
  const h = setup((url, res) => (url === '/api/rt/join' ? res(200, { tok: 't', live: true }) : res(200, { items: [], now: 1 })))
  await settle()
  FakeES.instances[0].open()
  await settle()
  FakeES.instances[0].message({ t: 'deleted', from: 'KM-OWNR-OWNR-OWNR' })
  assert.deepEqual(h.denied, [[404, 'Board not found']])
  assert.equal(FakeES.instances[0].readyState, 2, 'the stream is closed')
  assert.equal(shouldApply({ t: 'deleted', from: 'KM-X' }, { uid: ME, cid: 'c' }), true)
  assert.equal(shouldApply({ t: 'deleted' }, { uid: ME, cid: 'c' }), false, 'needs a sender like every envelope')
  h.sync.close()
})

test('a 429 from /api/rt/join: polls meanwhile, then asks for the stream again after Retry-After', async () => {
  let joins = 0
  const h = setup((url, res) => {
    if (url === '/api/rt/join') return ++joins === 1 ? res(429, { error: 'slow down' }, { 'retry-after': '7' }) : res(200, { tok: 't', live: true })
    return res(200, { items: [], now: 1 })
  })
  await settle()
  assert.equal(h.sync.status(), 'polling', 'not silent: it polls while it waits')
  assert.equal(FakeES.instances.length, 0)
  await h.timers.advance(6900)
  assert.equal(joins, 1)
  await h.timers.advance(200)
  assert.equal(joins, 2, 'joined again once Retry-After had passed')
  assert.equal(FakeES.instances.length, 1)
  h.sync.close()
})

test('polling asks from lastSeen - 2000 (merging is idempotent, so the overlap is free)', async () => {
  const h = setup((url, res) => (url === '/api/rt/join' ? res(200, { tok: 't', live: false }) : res(200, { items: [], now: 1 })), { lastSeen: 10_000 })
  await settle()
  assert.equal(h.urls('/api/boards/ABC234/since')[0].url, '/api/boards/ABC234/since?t=8000')
  h.sync.close()
  const low = setup((url, res) => (url === '/api/rt/join' ? res(200, { tok: 't', live: false }) : res(200, { items: [], now: 1 })), { lastSeen: 500 })
  await settle()
  assert.equal(low.urls('/api/boards/ABC234/since')[0].url, '/api/boards/ABC234/since?t=0', 'never negative')
  low.sync.close()
})

// --- the reveal page's polling loop -----------------------------------------------------------------------------------
test('poller: repeated nudges (visibilitychange storms) never multiply the chain; one timer is pending at a time', async () => {
  const timers = fakeTimers()
  let ticks = 0
  let release
  const poller = createPoller({
    tick: () => { ticks++; return new Promise((r) => { release = () => r(3000) }) },
    timers,
  })
  poller.start()
  for (let i = 0; i < 10; i++) poller.nudge() // 10 events while the first round is in flight
  assert.equal(ticks, 1)
  assert.equal(timers.count(), 0, 'nothing scheduled while a round is running')
  release()
  await settle()
  assert.equal(timers.count(), 1, 'the round schedules exactly its successor')
  for (let i = 0; i < 10; i++) poller.nudge() // between rounds: each nudge replaces the pending timer
  assert.equal(timers.count(), 1)
  await timers.advance(0)
  assert.equal(ticks, 2, 'ten nudges made one extra round, not ten')
  release()
  await settle()
  await timers.advance(2999)
  assert.equal(ticks, 2)
  await timers.advance(1)
  assert.equal(ticks, 3)
  poller.stop()
})

test('poller: a nudge every second for 12 s of fake time stays bounded, and nudges only ever bring the next round forward', async () => {
  const timers = fakeTimers()
  let ticks = 0
  const poller = createPoller({ tick: async () => { ticks++; return 3000 }, timers })
  poller.start()
  for (let s = 0; s < 12; s++) { poller.nudge(); await timers.advance(1000) }
  assert.ok(ticks <= 14, `ticks=${ticks}`)
  // The same run without any nudge is 5 rounds (t = 0, 3, 6, 9, 12); nudges only bring a round forward, one at a time.
  const quiet = fakeTimers()
  let q = 0
  const p2 = createPoller({ tick: async () => { q++; return 3000 }, timers: quiet })
  p2.start()
  await quiet.advance(12_000)
  assert.equal(q, 5)
  poller.stop()
  p2.stop()
  assert.equal(timers.count(), 0, 'stop leaves no timer behind')
})

test('poller: null ends the loop, a hidden tab slows it, stop() cancels everything, a throwing round ends quietly', async () => {
  const timers = fakeTimers()
  let ticks = 0
  let hidden = false
  const poller = createPoller({ tick: async () => (++ticks === 3 ? null : 700), timers, hidden: () => hidden, hiddenMinMs: 3000 })
  poller.start()
  await timers.advance(1500)
  assert.equal(ticks, 3, 'rounds at 0, 700, 1400')
  await timers.advance(10_000)
  assert.equal(ticks, 3, 'null stops it for good')
  poller.nudge()
  await timers.advance(1000)
  assert.equal(ticks, 5, 'a nudge restarts a quiet poller (rounds at 0 and 700 ms)')

  const t2 = fakeTimers()
  let n = 0
  hidden = true
  const slow = createPoller({ tick: async () => { n++; return 700 }, timers: t2, hidden: () => hidden, hiddenMinMs: 3000 })
  slow.start()
  await t2.advance(7000)
  assert.equal(n, 3, 'hidden: every 3 s')
  slow.stop()
  await t2.advance(10_000)
  assert.equal(n, 3)

  const t3 = fakeTimers()
  const bad = createPoller({ tick: async () => { throw new Error('x') }, timers: t3 })
  bad.start()
  await t3.advance(5000)
  assert.equal(t3.count(), 0)
})

test('useReveal runs its polling through the single-chain poller', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../src/ui/useReveal.js', import.meta.url), 'utf8')
  assert.match(src, /createPoller\(/)
  assert.doesNotMatch(src, /setTimeout\(tick/)
})
