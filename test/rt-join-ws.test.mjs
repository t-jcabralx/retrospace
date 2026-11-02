import test from 'node:test'
import assert from 'node:assert/strict'
process.env.RT_SECRET = 'test-secret'
import { call, routes } from './helpers/routes.mjs'

const { signUp, newGuest, newBoard } = await routes()
const { POST: join } = await import('../src/app/api/rt/join/route.js')
const { verifyTok, signTok } = await import('../src/lib/rt.js')

const owner = await signUp('olive')
const code = (await newBoard(owner.cookie)).data.code
const ann = await newGuest(code)
const ask = () => call(join, 'POST', '/api/rt/join', { body: { code }, cookie: ann.cookie, headers: { origin: 'http://localhost:3100' } })

test('without Redis there is no realtime address at all, whatever else is set', async () => {
  process.env.REALTIME_WS_URL = 'wss://rt.example/ws'
  process.env.REALTIME_SECRET = 'test-realtime-secret-0123456789'
  const r = await ask()
  assert.equal(r.status, 200)
  assert.equal(r.data.live, false)
  assert.ok(!('ws' in r.data) && !('wsTok' in r.data))
})

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  try { return await fn() } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
}
const REDIS = { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1', UPSTASH_REDIS_REST_TOKEN: 'fake' }
const ALL = { ...REDIS, REALTIME_WS_URL: 'wss://rt.example/ws', REALTIME_SECRET: 'test-realtime-secret-0123456789' }

test('with Redis, the address and the secret set: the browser gets the address and a ticket only the realtime backend accepts', async () => {
  await withEnv(ALL, async () => {
    const r = await ask()
    assert.equal(r.status, 200)
    assert.equal(r.data.live, true)
    assert.equal(r.data.ws, 'wss://rt.example/ws')
    assert.match(r.data.wsTok, /^\d{13}\.[0-9a-f]{32}$/)
    assert.equal(verifyTok(code, ann.uid, r.data.tok), true, 'the ordinary ticket is still there')
    assert.equal(verifyTok(code, ann.uid, r.data.wsTok), false, 'the websocket ticket does not work on the website\'s own routes')
    assert.notEqual(r.data.wsTok.split('.')[1], r.data.tok.split('.')[1])
  })
})

test('the address alone, or the secret alone, hands out nothing: both are needed', async () => {
  await withEnv({ ...ALL, REALTIME_SECRET: undefined }, async () => {
    const r = await ask()
    assert.ok(!('ws' in r.data) && !('wsTok' in r.data))
    assert.ok(r.data.tok, 'the ordinary path is untouched')
  })
  await withEnv({ ...ALL, REALTIME_WS_URL: undefined }, async () => assert.ok(!('wsTok' in (await ask()).data)))
  await withEnv({ ...ALL, REALTIME_SECRET: 'short' }, async () => assert.ok(!('wsTok' in (await ask()).data)), 'a weak secret counts as none')
})

test('only a ws:// or wss:// address is ever handed to a browser', async () => {
  for (const bad of ['https://rt.example/ws', 'javascript:alert(1)', 'wss://rt.example/ws"onload=1', 'wss://']) {
    await withEnv({ ...ALL, REALTIME_WS_URL: bad }, async () => assert.ok(!('ws' in (await ask()).data), bad))
  }
  await withEnv({ ...ALL, REALTIME_WS_URL: ' "ws://127.0.0.1:8090/ws" ' }, async () => assert.equal((await ask()).data.ws, 'ws://127.0.0.1:8090/ws', 'pasted quotes are removed'))
})
