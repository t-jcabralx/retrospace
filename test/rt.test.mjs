import test from 'node:test'
import assert from 'node:assert/strict'
import { chan, rtSecret, signTok, verifyTok, publish, rateLocal, rateOk } from '../src/lib/rt.js'

test('chan namespaces the board code', () => {
  assert.equal(chan('ABC234'), 'kb:ABC234')
})

const UID = 'KM-AAAA-BBBB-CCCC'

test('signTok is "<expMs>.<32 hex>" and stable for the same inputs', () => {
  const t = signTok('ABC234', UID, 1_000_000)
  assert.match(t, /^\d+\.[0-9a-f]{32}$/)
  assert.equal(t.split('.')[0], String(1_000_000 + 30 * 60 * 1000))
  assert.equal(signTok('ABC234', UID, 1_000_000), t)
  assert.equal(signTok('ABC234', UID, 1_000_000, 5000).split('.')[0], '1005000')
})

test('verifyTok accepts a valid token until it expires', () => {
  const t = signTok('ABC234', UID, 1_000_000)
  assert.equal(verifyTok('ABC234', UID, signTok('ABC234', UID)), true)
  assert.equal(verifyTok('ABC234', UID, t, 1_000_000 + 30 * 60 * 1000 - 1), true)
  assert.equal(verifyTok('ABC234', UID, t, 1_000_000 + 30 * 60 * 1000), false) // expired
  assert.equal(verifyTok('ABC234', UID, t, 1_000_000 + 31 * 60 * 1000), false)
})

test('verifyTok rejects a wrong uid, wrong code, tampered, re-dated or missing token', () => {
  const now = 5_000_000
  const tok = signTok('ABC234', UID, now)
  assert.equal(verifyTok('ABC234', 'KM-AAAA-BBBB-CCCD', tok, now), false)
  assert.equal(verifyTok('ABC235', UID, tok, now), false)
  assert.equal(verifyTok('ABC234', UID, tok.slice(0, -1) + (tok.endsWith('0') ? '1' : '0'), now), false)
  assert.equal(verifyTok('ABC234', UID, tok + 'x', now), false)
  const [exp, mac] = tok.split('.')
  assert.equal(verifyTok('ABC234', UID, `${Number(exp) + 3_600_000}.${mac}`, now), false) // extending the expiry breaks the MAC
  for (const bad of [undefined, null, '', 0, {}, ['x'], 'nodot', '.abc', `${exp}.`, `-1.${mac}`, `abc.${mac}`, `${exp}.${mac.toUpperCase()}`, `${'9'.repeat(30)}.${mac}`]) {
    assert.equal(verifyTok('ABC234', UID, bad, now), false, String(bad))
  }
})

test('the old tokens without an expiry (a bare 32-char HMAC) are no longer accepted', () => {
  assert.equal(verifyTok('ABC234', UID, 'a'.repeat(32)), false)
})

test('rtSecret: RT_SECRET; outside production the Upstash token or dev-secret stand in; in production only RT_SECRET (a vendor token is never borrowed)', () => {
  const keys = ['RT_SECRET', 'UPSTASH_REDIS_REST_TOKEN', 'NODE_ENV']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const restore = () => { for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]) }
  try {
    delete process.env.RT_SECRET
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.NODE_ENV = 'development'
    assert.equal(rtSecret(), 'dev-secret')
    assert.match(signTok('ABC234', UID), /^\d+\.[0-9a-f]{32}$/)

    process.env.NODE_ENV = 'production'
    assert.throws(() => rtSecret(), /RT_SECRET must be set in production/)
    assert.throws(() => signTok('ABC234', UID), /RT_SECRET must be set in production/)
    assert.throws(() => verifyTok('ABC234', UID, `${Date.now() + 1000}.${'a'.repeat(32)}`), /RT_SECRET must be set in production/)

    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token'
    assert.throws(() => rtSecret(), /RT_SECRET must be set in production/, 'the Upstash token is not a fallback in production')
    process.env.NODE_ENV = 'development'
    assert.equal(rtSecret(), 'upstash-token')
    process.env.NODE_ENV = 'production'
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.RT_SECRET = 'my-secret'
    assert.equal(rtSecret(), 'my-secret')
    assert.equal(verifyTok('ABC234', UID, signTok('ABC234', UID)), true)
  } finally {
    restore()
  }
})

test('publish does nothing and returns false without Redis', async () => {
  const saved = [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN]
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  try {
    assert.equal(await publish('ABC234', { t: 'ops', from: 'x', ops: [] }), false)
  } finally {
    if (saved[0] !== undefined) process.env.UPSTASH_REDIS_REST_URL = saved[0]
    if (saved[1] !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = saved[1]
  }
})

test('publish sends the JSON envelope on the board channel and returns true', async () => {
  const calls = []
  const redis = { publish: async (c, m) => { calls.push([c, m]); return 2 } }
  const env = { t: 'ops', from: 'KM-AAAA-BBBB-CCCC', ops: [{ id: 'a' }] }
  assert.equal(await publish('ABC234', env, redis), true)
  assert.deepEqual(calls, [['kb:ABC234', JSON.stringify(env)]])
})

test('publish swallows a Redis error, logs only the message, and returns false', async () => {
  const logged = []
  const orig = console.error
  console.error = (...a) => logged.push(a)
  try {
    const redis = { publish: async () => { throw Object.assign(new Error('boom'), { secret: 'token-123' }) } }
    assert.equal(await publish('ABC234', { t: 'ops' }, redis), false)
  } finally {
    console.error = orig
  }
  assert.equal(logged.length, 1)
  assert.equal(JSON.stringify(logged[0]).includes('token-123'), false)
  assert.equal(logged[0].some((x) => typeof x === 'string' && x.includes('boom')), true)
})

test('rateLocal allows perSecond calls per uid then refuses', () => {
  const uid = 'KM-RATE-TEST-AAAA'
  const results = Array.from({ length: 5 }, () => rateLocal(uid, 3))
  assert.deepEqual(results.slice(0, 3), [true, true, true])
  assert.equal(results[3] && results[4], false)
  assert.equal(rateLocal('KM-RATE-TEST-BBBB', 3), true)
})

test('rateOk counts with incr and sets an expiry on the first hit', async () => {
  let n = 0
  const expired = []
  const redis = { incr: async () => ++n, expire: async (k, s) => { expired.push([k, s]) } }
  assert.equal(await rateOk(redis, 'u', 2), true)
  assert.equal(await rateOk(redis, 'u', 2), true)
  assert.equal(await rateOk(redis, 'u', 2), false)
  assert.equal(expired.length, 1)
})

test('the token is domain-separated: it is the HMAC of "tok:<code>:<id>:<exp>", and no other namespace verifies as one', async () => {
  const { createHmac } = await import('node:crypto')
  const { publicId, publicIdForUser } = await import('../src/lib/guest.js')
  const { buildAccessCookie } = await import('../src/lib/access.js')
  const exp = 9_999_999_999_999
  const mac = (input) => createHmac('sha256', rtSecret()).update(input).digest('hex').slice(0, 32)
  assert.equal(signTok('ABC234', UID, exp - 30 * 60 * 1000), `${exp}.${mac(`tok:ABC234:${UID}:${exp}`)}`)
  // the old un-tagged input no longer verifies
  assert.equal(verifyTok('ABC234', UID, `${exp}.${mac(`ABC234:${UID}:${exp}`)}`), false)
  // other namespaces' MACs over lookalike inputs do not verify either
  assert.equal(verifyTok('ABC234', UID, `${exp}.${mac(`pid:ABC234:${UID}:${exp}`)}`), false)
  assert.equal(verifyTok('ABC234', UID, `${exp}.${mac(`guest:${UID}`)}`), false)
  assert.equal(verifyTok('ABC234', UID, `${exp}.${buildAccessCookie({ code: 'ABC234', passcodeHash: 'x' }).split('=')[1].slice(0, 32)}`), false)
  assert.notEqual(publicId('ABC234', UID), publicIdForUser('ABC234', UID))
})
