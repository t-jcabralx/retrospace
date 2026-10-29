import test from 'node:test'
import assert from 'node:assert/strict'
import { envValue, messyEnv, upstashConfig } from '../src/lib/db.js'

test('envValue strips spaces and matching quotes, and nothing else', () => {
  assert.equal(envValue('A', { A: '"https://x.upstash.io"' }), 'https://x.upstash.io')
  assert.equal(envValue('A', { A: "  'tok'  " }), 'tok')
  assert.equal(envValue('A', { A: ' plain ' }), 'plain')
  assert.equal(envValue('A', { A: 'say "hi"' }), 'say "hi"') // quotes inside stay
  assert.equal(envValue('A', { A: '"unbalanced' }), '"unbalanced')
  assert.equal(envValue('A', {}), '')
  assert.equal(envValue('A', { A: '""' }), '')
})

test('upstashConfig cleans the URL and token, drops a trailing slash, and needs both', () => {
  assert.deepEqual(upstashConfig({ UPSTASH_REDIS_REST_URL: '"https://x.upstash.io/"', UPSTASH_REDIS_REST_TOKEN: '"abc"' }), { url: 'https://x.upstash.io', token: 'abc' })
  assert.equal(upstashConfig({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' }), null)
  assert.equal(upstashConfig({}), null)
})

test('messyEnv names only the settings that carry stray quotes or spaces', () => {
  const env = { A: '"x"', B: 'fine', C: ' y', D: '' }
  assert.deepEqual(messyEnv(['A', 'B', 'C', 'D', 'E'], env), ['A', 'C'])
})

test('the health route reports settings by name only, never a value', async () => {
  for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]
  process.env.RT_SECRET = '"super-secret-value"'
  const { GET } = await import('../src/app/api/health/route.js')
  const res = await GET()
  const text = await res.text()
  assert.equal(res.status, 200)
  const body = JSON.parse(text)
  assert.equal(body.settings.RT_SECRET, true)
  assert.equal(body.settings.UPSTASH_REDIS_REST_URL, false)
  assert.deepEqual(body.tidy, ['RT_SECRET'])
  assert.ok(!text.includes('super-secret-value'))
})
