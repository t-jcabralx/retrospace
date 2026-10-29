import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createAlerter, describe } from '../src/lib/alert.js'

const mk = (extra = {}) => {
  const calls = []
  let t = 1_000_000
  const alerter = createAlerter({ url: 'https://hooks.example/x', now: () => t, fetchImpl: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true } }, ...extra })
  return { alerter, calls, tick: (ms) => { t += ms } }
}

test('a failure is posted as a short message with the method, the path and what broke', async () => {
  const { alerter, calls } = mk()
  assert.equal(await alerter(new Error('RT_SECRET must be set in production'), { method: 'POST', path: '/api/boards' }), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.text, 'Retrospace error: POST /api/boards: RT_SECRET must be set in production')
  assert.equal(calls[0].body.content, calls[0].body.text)
})

test('what is sent is blurred: board codes in paths, long ids, emails and long numbers never appear', () => {
  const d = describe(new Error('E11000 duplicate key for ann@example.com id aVeryLongOpaqueIdentifier1234567890 at 1730000000000'), { method: 'GET', path: '/api/boards/ABC234/ops?token=secret' })
  assert.equal(d.path, '/api/boards/:code/ops')
  assert.ok(!/ann@|aVeryLong|1730000000000|secret/.test(JSON.stringify(d)), JSON.stringify(d))
})

test('the same problem is reported once in ten minutes, different ones separately, and never more than twenty an hour', async () => {
  const { alerter, calls, tick } = mk()
  const req = { method: 'GET', path: '/x' }
  assert.equal(await alerter(new Error('boom'), req), true)
  assert.equal(await alerter(new Error('boom'), req), false)
  assert.equal(await alerter(new Error('other'), req), true)
  tick(11 * 60_000)
  assert.equal(await alerter(new Error('boom'), req), true)
  assert.equal(calls.length, 3)
  const flood = mk()
  let sent = 0
  for (let i = 0; i < 40; i++) if (await flood.alerter(new Error(`unique ${i}`), req)) sent++
  assert.equal(sent, 20)
})

test('without a webhook nothing is sent, and a failing webhook never throws', async () => {
  assert.equal(await createAlerter({})(new Error('x'), {}), false)
  const { alerter } = mk({ fetchImpl: async () => { throw new Error('network') } })
  assert.equal(await alerter(new Error('x'), { method: 'GET', path: '/a' }), false)
})

test('CI runs the tests and the build on every push, and instrumentation only acts with a webhook set', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  for (const word of ['npm ci', 'npm test', 'npm run build', 'pull_request', 'MONGODB_URI']) assert.ok(ci.includes(word), word)
  const ins = await readFile(new URL('../src/instrumentation.js', import.meta.url), 'utf8')
  assert.ok(ins.includes('ERROR_WEBHOOK_URL') && ins.includes('onRequestError'))
})
