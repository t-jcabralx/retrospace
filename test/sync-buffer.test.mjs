import test from 'node:test'
import assert from 'node:assert/strict'
import { createSync, compactQueue } from '../src/client/sync.js'

const upd = (id, patch) => ({ op: 'update', id, patch })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('compactQueue merges runs of updates on one item and keeps order and other ops', () => {
  const out = compactQueue([upd('a', { x: 1 }), upd('b', { x: 5 }), upd('a', { y: 2 }), upd('a', { x: 9, data: { t: 1 } }), upd('a', { data: { u: 2 } })])
  assert.deepEqual(out, [upd('a', { x: 9, y: 2, data: { t: 1, u: 2 } }), upd('b', { x: 5 })])
})

test('compactQueue never merges across an add or delete of the same item, and does not mutate its input', () => {
  const input = [upd('a', { x: 1 }), { op: 'delete', id: 'a' }, { op: 'add', id: 'a', item: { id: 'a' } }, upd('a', { x: 2 }), upd('a', { x: 3 })]
  const copy = structuredClone(input)
  const out = compactQueue(input)
  assert.deepEqual(input, copy)
  assert.deepEqual(out.map((o) => o.op + (o.patch ? JSON.stringify(o.patch) : '')), ['update{"x":1}', 'delete', 'add', 'update{"x":3}'])
})

function rig({ opsOk = () => true } = {}) {
  const calls = []
  const handlers = {}
  const pageEvents = { addEventListener: (t, f) => { (handlers[t] ||= new Set()).add(f) }, removeEventListener: (t, f) => handlers[t]?.delete(f) }
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined
    calls.push({ url, keepalive: opts.keepalive === true, body })
    if (url === '/api/rt/join') return res(200, { tok: 't', live: false })
    if (url.includes('/since')) return res(200, { items: [], now: 1 })
    if (url.endsWith('/ops')) return opsOk(calls) ? res(200, { applied: body.ops.map((o) => ({ id: o.id, updatedAt: 1 })), rejected: [] }) : res(503, {})
    return res(404, {})
  }
  const fire = (t) => { for (const f of [...(handlers[t] ?? [])]) f() }
  const sync = createSync({ code: 'ABC234', identity: { uid: 'KM-AAAA-BBBB-CCCC' }, fetchImpl, pageEvents, EventSourceImpl: undefined })
  const opsCalls = () => calls.filter((c) => c.url.endsWith('/ops'))
  return { sync, fire, handlers, opsCalls }
}

test('hiding the tab sends the queue at once, with keepalive, instead of waiting for the batch timer', async () => {
  const { sync, fire, opsCalls } = rig()
  await wait(20)
  sync.send([upd('a', { x: 1 })])
  fire('pagehide')
  await wait(10)
  assert.equal(opsCalls().length, 1)
  assert.equal(opsCalls()[0].keepalive, true)
  sync.close()
})

test('the browser coming back online resends what an outage left queued without waiting for a poll', async () => {
  let down = true
  const { sync, fire, opsCalls } = rig({ opsOk: () => !down })
  await wait(20)
  sync.send([upd('a', { x: 1 })])
  await wait(6500) // three retries (500 + 1500 + 4000 ms) fail, the op stays queued
  const failed = opsCalls().length
  down = false
  fire('online')
  await wait(50)
  assert.ok(opsCalls().length > failed)
  assert.deepEqual(opsCalls().at(-1).body.ops.map((o) => o.id), ['a'])
  sync.close()
})

test('close removes the page listeners', async () => {
  const { sync, handlers } = rig()
  assert.ok(handlers.online.size === 1 && handlers.pagehide.size === 1 && handlers.visibilitychange.size === 1)
  sync.close()
  assert.ok(handlers.online.size === 0 && handlers.pagehide.size === 0 && handlers.visibilitychange.size === 0)
})
