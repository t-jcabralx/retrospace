import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`
const published = (cmds) => cmds.filter((c) => c[0] === 'publish').map((c) => [c[1], JSON.parse(c[2])])

async function call(handler, path, { body, cookie, code, ip = fakeIp() }) {
  const h = { 'x-forwarded-for': ip, 'content-type': 'application/json' }
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  return { status: res.status, data: await res.json().catch(() => ({})), res }
}
const reg = await register(new Request('http://localhost:3100/api/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() },
  body: JSON.stringify({ email: `l-${rnd()}@example.com`, name: 'Lia', password: 'correct horse battery' }),
}))
const cookie = reg.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0]

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

test('ops are limited per board participant (300 a minute), not per address: a room behind one Wi-Fi address is not shut out', async () => {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 8_000) await new Promise((r) => setTimeout(r, left + 100))
  await fakeUpstash(async () => {
    const code = (await call(createBoard, '/api/boards', { cookie, body: { type: 'workshop', template: 'blank', title: 'T' } })).data.code
    const ip = '203.0.113.9' // everyone behind the same address
    const send = () => call(opsRoute, `/api/boards/${code}/ops`, { code, cookie, ip, body: { ops: [{ op: 'zzz' }] } })
    let last
    for (let i = 0; i < 300; i++) last = await send()
    assert.equal(last.status, 200, 'the 300th op request of a minute is fine (the old per-address limit was 600, shared by the whole room)')
    const over = await send()
    assert.equal(over.status, 429)
    assert.ok(Number(over.res.headers.get('retry-after')) > 0)
  })
})

test('a stream envelope is slim for a move and whole for an add (end to end through the ops route)', async () => {
  await fakeUpstash(async (cmds) => {
    const code = (await call(createBoard, '/api/boards', { cookie, body: { type: 'workshop', template: 'blank', title: 'T' } })).data.code
    const src = 'data:image/webp;base64,' + 'A'.repeat(5000)
    const post = (ops) => call(opsRoute, `/api/boards/${code}/ops`, { code, cookie, body: { ops } })
    assert.equal((await post([{ op: 'add', item: { id: 'img1', kind: 'image', x: 0, y: 0, w: 100, h: 100, data: { src } } }])).data.applied.length, 1)
    assert.equal((await post([{ op: 'update', id: 'img1', patch: { x: 40 } }])).data.applied.length, 1)
    const envs = published(cmds).map(([, e]) => e).filter((e) => e.t === 'ops')
    assert.equal(envs.length, 2)
    assert.equal(envs[0].ops[0].data.src, src, 'the add goes out whole')
    assert.equal(envs[1].ops[0].slim, true)
    assert.equal(envs[1].ops[0].data.src, undefined, 'the move goes out without the picture')
    assert.equal(envs[1].ops[0].x, 40)
    const del = await post([{ op: 'delete', id: 'img1' }])
    assert.deepEqual(del.data.applied[0].data, {}, 'a tombstone keeps no data')
  })
})
