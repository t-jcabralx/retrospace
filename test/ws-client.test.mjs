import test from 'node:test'
import assert from 'node:assert/strict'
import { createWsStream, MAX_QUICK_RETRIES } from '../src/client/wsStream.js'
import { createSync } from '../src/client/sync.js'

const fast = { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout, setInterval: (fn) => setInterval(fn, 1e9), clearInterval }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

class FakeWS {
  static made = []
  static plan = [] // what each new socket does: 'open' | { closeWith: code }
  constructor(url) {
    this.url = url
    this.sent = []
    FakeWS.made.push(this)
    const step = FakeWS.plan.shift() ?? 'open'
    queueMicrotask(() => {
      if (step === 'open') this.onopen?.()
      else this.onclose?.({ code: step.closeWith })
    })
  }
  send(t) { this.sent.push(t) }
  close(code) { this.closedWith = code }
  push(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  drop(code) { this.onclose?.({ code }) }
}
class FakeES {
  static made = []
  constructor(url) { this.url = url; this.readyState = 0; this.l = {}; FakeES.made.push(this) }
  addEventListener(t, fn) { (this.l[t] ??= []).push(fn) }
  close() { this.readyState = 2 }
  open() { this.readyState = 1; for (const f of this.l.open ?? []) f({}) }
}
const reset = () => { FakeWS.made = []; FakeWS.plan = []; FakeES.made = [] }

function harness({ ws = 'wss://rt.example/ws' } = {}) {
  const calls = []
  const events = { remote: [], eph: [], status: [] }
  const fetchImpl = async (url, o) => {
    calls.push({ url, body: o?.body ? JSON.parse(o.body) : undefined })
    const ok = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data })
    if (url === '/api/rt/join') return ok({ tok: 'TICKET', live: true, ...(ws && { ws }) })
    if (url === '/api/rt/send') return ok({ ok: true })
    return ok({ items: [], now: Date.now() })
  }
  const sync = createSync({
    code: 'ABC234', identity: { uid: 'KM-AAAA-BBBB-CCCC' }, cid: 'tab-1', fetchImpl, EventSourceImpl: FakeES, WebSocketImpl: FakeWS, timers: fast, pageEvents: null,
    onRemote: (items) => events.remote.push(items), onEphemeral: (msg, from) => events.eph.push([msg, from]), onStatus: (s) => events.status.push(s),
  })
  return { sync, calls, events }
}

test('WsStream: opens, passes messages on, and reports closed (readyState 2) when the server asks for a new ticket', async () => {
  reset()
  const WsStream = createWsStream({ WebSocketImpl: FakeWS, timers: fast })
  const s = new WsStream('wss://x/ws?code=ABC234')
  const seen = []
  s.addEventListener('open', () => seen.push('open'))
  s.addEventListener('message', (e) => seen.push(e.data))
  s.addEventListener('error', () => seen.push(`error:${s.readyState}`))
  await wait(10)
  assert.deepEqual([s.readyState, s.everOpened, s.isWebSocket], [1, true, true])
  FakeWS.made[0].push({ t: 'ops' })
  assert.equal(s.send('hi'), true)
  assert.deepEqual(FakeWS.made[0].sent, ['hi'])
  FakeWS.made[0].drop(4001)
  assert.deepEqual(seen, ['open', '{"t":"ops"}', 'error:2'])
  assert.equal(s.send('late'), false)
})

test('WsStream: a dropped connection is retried a few times with the same ticket, then reported closed', async () => {
  reset()
  FakeWS.plan = ['open', { closeWith: 1006 }, { closeWith: 1006 }, { closeWith: 1006 }, { closeWith: 1006 }, { closeWith: 1006 }]
  const WsStream = createWsStream({ WebSocketImpl: FakeWS, timers: fast })
  const s = new WsStream('wss://x/ws')
  const states = []
  s.addEventListener('error', () => states.push(s.readyState))
  await wait(10)
  FakeWS.made[0].drop(1006)
  await wait(80)
  assert.equal(FakeWS.made.length, 1 + MAX_QUICK_RETRIES, 'the first connection, then the quick retries')
  assert.equal(states.at(-1), 2)
  assert.ok(states.slice(0, -1).every((x) => x === 0), 'connecting while it retries')
})

test('with an address from the website, the page connects to the realtime server with its ticket, and what arrives is applied', async () => {
  reset()
  const { sync, calls, events } = harness()
  await wait(30)
  assert.equal(calls[0].url, '/api/rt/join')
  assert.equal(FakeES.made.length, 0, 'the plain stream is not used')
  const url = new URL(FakeWS.made[0].url)
  assert.deepEqual([url.origin, url.pathname], ['wss://rt.example', '/ws'])
  assert.deepEqual([url.searchParams.get('code'), url.searchParams.get('uid'), url.searchParams.get('tok'), url.searchParams.get('cid')], ['ABC234', 'KM-AAAA-BBBB-CCCC', 'TICKET', 'tab-1'])
  assert.equal(sync.status(), 'live')
  FakeWS.made[0].push({ t: 'ops', from: 'KM-OTHER', cid: 'tab-9', ops: [{ id: 'a', updatedAt: 5 }] })
  FakeWS.made[0].push({ t: 'ops', from: 'KM-AAAA-BBBB-CCCC', cid: 'tab-1', ops: [{ id: 'mine', updatedAt: 6 }] })
  FakeWS.made[0].push({ t: 'err', status: 429, error: 'slow down' })
  FakeWS.made[0].push({ t: 'eph', from: 'KM-OTHER', cid: 'tab-9', msg: { t: 'cursor', x: 1, y: 2 } })
  assert.deepEqual(events.remote.map((r) => r[0].id), ['a'], 'a peer\'s change is applied, this tab\'s own echo and server notes are not')
  assert.deepEqual(events.eph, [[{ t: 'cursor', x: 1, y: 2 }, 'KM-OTHER']])
  sync.close()
})

test('live messages are written to the socket (no request); one that needs an answer still goes as a request', async () => {
  reset()
  const { sync, calls } = harness()
  await wait(30)
  const before = calls.length
  sync.sendEphemeral({ t: 'cursor', x: 3, y: 4 })
  await wait(10)
  assert.deepEqual(FakeWS.made[0].sent.map((t) => JSON.parse(t)), [{ t: 'eph', msg: { t: 'cursor', x: 3, y: 4 } }])
  assert.equal(calls.length, before, 'no /api/rt/send request for a cursor')
  const answers = []
  sync.sendEphemeral({ t: 'celebrate', effect: 'confetti' }, (status) => answers.push(status))
  await wait(60)
  assert.equal(calls.at(-1).url, '/api/rt/send', 'a message the sender needs an answer to is a request')
  assert.deepEqual(answers, [200])
  sync.close()
})

test('without an address, nothing changes: the plain stream and requests are used', async () => {
  reset()
  const { sync, calls } = harness({ ws: null })
  await wait(30)
  assert.equal(FakeWS.made.length, 0)
  assert.equal(FakeES.made.length, 1)
  assert.match(FakeES.made[0].url, /^\/api\/rt\/stream\?/)
  FakeES.made[0].open()
  sync.sendEphemeral({ t: 'cursor', x: 1, y: 1 })
  await wait(30)
  assert.equal(calls.at(-1).url, '/api/rt/send')
  sync.close()
})

test('if the realtime server cannot be reached, this page falls back to the plain stream', async () => {
  reset()
  FakeWS.plan = Array.from({ length: 10 }, () => ({ closeWith: 1006 }))
  const { sync, calls } = harness()
  await wait(150)
  assert.ok(FakeWS.made.length >= 1 + MAX_QUICK_RETRIES, 'it tried')
  assert.equal(FakeES.made.length, 1, 'then the plain stream opened')
  assert.equal(calls.filter((c) => c.url === '/api/rt/join').length >= 2, true, 'with a fresh ticket')
  sync.close()
})

test('when the server says "reconnect" (the connection reached its age limit) the page asks for a new ticket and connects again', async () => {
  reset()
  const { sync, calls } = harness()
  await wait(30)
  const first = FakeWS.made.length
  FakeWS.made[0].drop(4001)
  await wait(60)
  assert.equal(calls.filter((c) => c.url === '/api/rt/join').length, 2)
  assert.equal(FakeWS.made.length, first + 1)
  assert.equal(FakeES.made.length, 0, 'still the realtime server: it had worked')
  sync.close()
})
