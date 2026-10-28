import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore, createMongoStore } from '../src/lib/store.js'
import { hashKey } from '../src/lib/hash.js'
import { validateRegister, validateLogin } from '../src/lib/validate.js'
import { rateLimited, windowHit, windowCount, windowClear, localWindowSize, credWindowSize, clientIp, retryAfterSecs, tooMany } from '../src/lib/http.js'
import {
  createSessionFor, getSessionUser, clearSessionCookie, requireJson, requireSameOrigin, publicUser, newUserId,
  SESSION_COOKIE,
} from '../src/lib/auth.js'

const DAY = 24 * 3600 * 1000
const mkUser = (over = {}) => ({ id: newUserId(), email: 'ann@example.com', name: 'Ann', passwordHash: 'scrypt$x', createdAt: 1, ...over })
const reqWith = (headers = {}, url = 'http://localhost:3100/api/auth/login', method = 'POST') => new Request(url, { method, headers })
const tokenOf = (cookie) => cookie.split(';')[0].split('=')[1]

async function withEnv(env, fn) {
  const saved = {}
  for (const k of Object.keys(env)) saved[k] = process.env[k]
  try {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}

test('newUserId is u_ plus 16 hex chars and unique', () => {
  const a = newUserId()
  assert.match(a, /^u_[0-9a-f]{16}$/)
  assert.notEqual(a, newUserId())
})

test('createUser lowercases the email and returns a clean doc', async () => {
  const s = createMemoryStore()
  const created = await s.createUser(mkUser({ email: ' Ann@Example.COM ' }))
  assert.equal(created.email, 'ann@example.com')
  assert.equal('_id' in created, false)
  assert.equal((await s.getUserByEmail('ANN@example.com')).id, created.id)
  assert.equal((await s.getUserById(created.id)).email, 'ann@example.com')
})

test('duplicate email is rejected with code 11000, case-insensitively', async () => {
  const s = createMemoryStore()
  await s.createUser(mkUser())
  await assert.rejects(s.createUser(mkUser({ id: newUserId(), email: 'ANN@EXAMPLE.COM' })), (e) => e.code === 11000)
  await s.createUser(mkUser({ id: newUserId(), email: 'bob@example.com' })) // others still fine
})

test('user lookups return null when missing and never alias stored state', async () => {
  const s = createMemoryStore()
  assert.equal(await s.getUserByEmail('nobody@example.com'), null)
  assert.equal(await s.getUserById('u_0000000000000000'), null)
  const u = await s.createUser(mkUser())
  u.name = 'mutated'
  assert.equal((await s.getUserById(u.id)).name, 'Ann')
})

test('sessions: lookup by token hash, delete, and expired sessions are not returned', async () => {
  const s = createMemoryStore()
  const now = Date.now()
  await s.createSession({ tokenHash: 'h-live', userId: 'u_1', createdAt: now, lastSeenAt: now, expiresAt: now + DAY })
  await s.createSession({ tokenHash: 'h-dead', userId: 'u_1', createdAt: now - 2 * DAY, lastSeenAt: now - 2 * DAY, expiresAt: now - DAY })
  const live = await s.getSessionByTokenHash('h-live')
  assert.equal(live.userId, 'u_1')
  assert.equal('_id' in live, false)
  assert.equal(await s.getSessionByTokenHash('h-dead'), null)
  assert.equal(await s.getSessionByTokenHash('h-none'), null)
  await s.deleteSession('h-live')
  assert.equal(await s.getSessionByTokenHash('h-live'), null)
  await s.deleteSession('h-live') // deleting twice is harmless
})

test('touchSession updates lastSeenAt only', async () => {
  const s = createMemoryStore()
  const now = Date.now()
  await s.createSession({ tokenHash: 'h', userId: 'u_1', createdAt: now, lastSeenAt: now, expiresAt: now + DAY })
  await s.touchSession('h', now + 5000)
  const got = await s.getSessionByTokenHash('h')
  assert.equal(got.lastSeenAt, now + 5000)
  assert.equal(got.expiresAt, now + DAY)
  await s.touchSession('missing', now) // no throw
})

test('createSessionFor stores only the token hash and sets a 30 day expiry', async () => {
  const s = createMemoryStore()
  const u = await s.createUser(mkUser())
  const now = 1_700_000_000_000
  const { token, cookie } = await createSessionFor(u.id, now, s)
  assert.match(token, /^[A-Za-z0-9_-]{43}$/) // 32 bytes base64url
  const row = await s.getSessionByTokenHash(hashKey(token), now)
  assert.equal(row.userId, u.id)
  assert.equal(row.createdAt, now)
  assert.equal(row.lastSeenAt, now)
  assert.equal(row.expiresAt, now + 30 * DAY)
  assert.equal(JSON.stringify(row).includes(token), false)
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=${token};`))
  const other = await createSessionFor(u.id, now, s)
  assert.notEqual(other.token, token)
})

test('session cookie has the required attributes and Secure only in production', async () => {
  const s = createMemoryStore()
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { cookie } = await createSessionFor('u_1', Date.now(), s)
    for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(cookie.split('; ').includes(attr), attr)
    assert.equal(cookie.includes('Secure'), false)
    assert.equal(clearSessionCookie().includes('Secure'), false)
  })
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const { cookie } = await createSessionFor('u_1', Date.now(), s)
    assert.ok(cookie.split('; ').includes('Secure'))
    assert.ok(clearSessionCookie().split('; ').includes('Secure'))
  })
})

test('clearSessionCookie expires the cookie with matching attributes', async () => {
  await withEnv({ NODE_ENV: 'test' }, async () => {
    const c = clearSessionCookie()
    assert.ok(c.startsWith(`${SESSION_COOKIE}=;`))
    for (const attr of ['Max-Age=0', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(c.split('; ').includes(attr), attr)
  })
})

test('getSessionUser returns the public user for a valid cookie', async () => {
  const s = createMemoryStore()
  const u = await s.createUser(mkUser())
  const { token } = await createSessionFor(u.id, Date.now(), s)
  const got = await getSessionUser(reqWith({ cookie: `a=1; ${SESSION_COOKIE}=${token}; b=2` }), { store: s })
  assert.deepEqual(got, { id: u.id, email: 'ann@example.com', name: 'Ann' })
  assert.deepEqual(publicUser(u), got)
  assert.equal('passwordHash' in got, false)
})

test('getSessionUser returns null for garbage, missing, unknown, expired and orphaned sessions', async () => {
  const s = createMemoryStore()
  const u = await s.createUser(mkUser())
  const now = Date.now()
  const { token } = await createSessionFor(u.id, now - 31 * DAY, s) // expired
  const orphan = await createSessionFor('u_ffffffffffffffff', now, s) // user does not exist
  const garbage = [
    undefined, '', ';;;', '=', `${SESSION_COOKIE}`, `${SESSION_COOKIE}=`, `${SESSION_COOKIE}=%E0%A4%A`,
    `${SESSION_COOKIE}=${'x'.repeat(5000)}`, `${SESSION_COOKIE}=not a token`, `${SESSION_COOKIE}=${'A'.repeat(43)}`,
    `other=${token}`, `${SESSION_COOKIE}=${token}`, `${SESSION_COOKIE}=${orphan.token}`, 'a=b; ; ;c',
  ]
  for (const cookie of garbage) {
    const headers = cookie === undefined ? {} : { cookie }
    assert.equal(await getSessionUser(reqWith(headers), { store: s }), null, String(cookie).slice(0, 40))
  }
  // control characters cannot ride in a real header, but a duck-typed request must still not throw
  const odd = { headers: { get: () => '\u0000\u0001; \u0000=\u0001' } }
  assert.equal(await getSessionUser(odd, { store: s }), null)
})

test('getSessionUser touches a session at most once per hour', async () => {
  const s = createMemoryStore()
  const calls = []
  const spy = { ...s, touchSession: async (h, n) => { calls.push(n); return s.touchSession(h, n) } }
  const u = await s.createUser(mkUser())
  const t0 = Date.now()
  const { token } = await createSessionFor(u.id, t0, spy)
  const req = reqWith({ cookie: `${SESSION_COOKIE}=${token}` })
  await getSessionUser(req, { store: spy, now: t0 + 60_000 })
  await getSessionUser(req, { store: spy, now: t0 + 59 * 60_000 })
  assert.equal(calls.length, 0) // under an hour since creation: no write
  await getSessionUser(req, { store: spy, now: t0 + 61 * 60_000 })
  assert.deepEqual(calls, [t0 + 61 * 60_000])
  await getSessionUser(req, { store: spy, now: t0 + 90 * 60_000 })
  assert.equal(calls.length, 1) // within the hour of the last touch
  await getSessionUser(req, { store: spy, now: t0 + 125 * 60_000 })
  assert.equal(calls.length, 2)
})

test('a failing touch does not fail authentication', async (t) => {
  t.mock.method(console, 'error', () => {})
  const s = createMemoryStore()
  const u = await s.createUser(mkUser())
  const t0 = Date.now()
  const { token } = await createSessionFor(u.id, t0, s)
  const broken = { ...s, touchSession: async () => { throw new Error('db down') } }
  const got = await getSessionUser(reqWith({ cookie: `${SESSION_COOKIE}=${token}` }), { store: broken, now: t0 + 2 * 3600_000 })
  assert.equal(got.id, u.id)
})

test('requireSameOrigin accepts a missing or matching Origin and rejects others', async () => {
  const ok = (h) => requireSameOrigin(reqWith(h))
  assert.equal(ok({ host: 'localhost:3100' }), null)
  assert.equal(ok({ host: 'localhost:3100', origin: 'http://localhost:3100' }), null)
  assert.equal(ok({ host: 'app.example.com', origin: 'https://app.example.com' }), null)
  assert.equal(ok({ host: 'internal:3000', 'x-forwarded-host': 'app.example.com', origin: 'https://app.example.com' }), null)
  for (const origin of ['http://evil.example', 'https://localhost:3101', 'null', 'not a url', 'http://localhost:3100.evil.example']) {
    const res = ok({ host: 'localhost:3100', origin })
    assert.equal(res.status, 403, origin)
    assert.deepEqual(await res.json(), { error: 'Cross-origin request blocked' })
  }
})

test('requireJson accepts application/json (with a charset) and rejects everything else', async () => {
  assert.equal(requireJson(reqWith({ 'content-type': 'application/json' })), null)
  assert.equal(requireJson(reqWith({ 'content-type': 'application/json; charset=utf-8' })), null)
  assert.equal(requireJson(reqWith({ 'content-type': 'Application/JSON' })), null)
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', undefined]) {
    const res = requireJson(reqWith(ct === undefined ? {} : { 'content-type': ct }))
    assert.equal(res.status, 415, String(ct))
    assert.deepEqual(await res.json(), { error: 'Content-Type must be application/json' })
  }
})

test('validateRegister normalises and accepts a good body', () => {
  const r = validateRegister({ email: '  Ann@Example.COM ', name: '  Ann\u0000  Lee ', password: 'abcdefghij' })
  assert.deepEqual(r, { ok: true, value: { email: 'ann@example.com', name: 'Ann Lee', password: 'abcdefghij' } })
})

test('validateRegister edge cases', () => {
  const good = { email: 'a@b.co', name: 'A', password: 'abcdefghij' }
  const bad = (over) => validateRegister({ ...good, ...over })
  assert.equal(validateRegister(good).ok, true)
  assert.equal(validateRegister(null).ok, false)
  assert.equal(validateRegister([]).ok, false)
  for (const email of ['', 'a', 'a@b', 'a@b.', '@b.co', 'a b@c.co', 'a@@b.co', 5, null, undefined, `${'a'.repeat(250)}@b.co`]) {
    assert.equal(bad({ email }).ok, false, String(email).slice(0, 30))
  }
  assert.equal(bad({ email: `${'a'.repeat(240)}@b.co` }).ok, true) // under 254
  for (const name of ['', '   ', '\u0000\u0001', 'x'.repeat(61), 5, null, undefined]) assert.equal(bad({ name }).ok, false, String(name))
  assert.equal(bad({ name: 'x'.repeat(60) }).ok, true)
  assert.equal(bad({ password: 'a'.repeat(9) }).ok, false)
  assert.equal(bad({ password: 'a'.repeat(10) }).ok, true)
  assert.equal(bad({ password: 'a'.repeat(128) }).ok, true)
  assert.equal(bad({ password: 'a'.repeat(129) }).ok, false)
  for (const password of [undefined, null, 1234567890, ['abcdefghij'], {}]) assert.equal(bad({ password }).ok, false)
  assert.equal(bad({ password: '          ' }).ok, true) // no trimming: ten spaces is ten characters
  assert.equal(bad({ password: ' abcdefghi ' }).value.password, ' abcdefghi ') // kept verbatim
  assert.equal(typeof bad({ password: 'short' }).error, 'string')
})

test('validateLogin edge cases', () => {
  assert.deepEqual(validateLogin({ email: ' A@B.co ', password: 'x' }), { ok: true, value: { email: 'a@b.co', password: 'x' } })
  assert.equal(validateLogin({ email: 'a@b.co', password: 'a'.repeat(128) }).ok, true)
  assert.equal(validateLogin({ email: 'a@b.co', password: 'a'.repeat(129) }).ok, false)
  for (const password of ['', undefined, null, 7, {}]) assert.equal(validateLogin({ email: 'a@b.co', password }).ok, false)
  for (const email of ['', 'nope', 7, undefined, 'a'.repeat(255)]) assert.equal(validateLogin({ email, password: 'x' }).ok, false)
  assert.equal(validateLogin(null).ok, false)
  assert.equal(validateLogin('str').ok, false)
})

const noRedis = { redis: null }

test('rateLimited without fallback is false when Redis is absent; with fallback it counts per kind and ip', async () => {
  const ip = (n) => reqWith({ 'x-forwarded-for': `10.0.0.${n}, 1.1.1.1` })
  const t0 = 60_000 * 1000
  for (let i = 0; i < 20; i++) assert.equal(await rateLimited(ip(1), 'k-nofb', 3, { ...noRedis, now: t0 }), false)
  const opts = { ...noRedis, localFallback: true, now: t0 }
  const seq = []
  for (let i = 0; i < 5; i++) seq.push(await rateLimited(ip(2), 'k-fb', 3, opts))
  assert.deepEqual(seq, [false, false, false, true, true])
  assert.equal(await rateLimited(ip(3), 'k-fb', 3, opts), false) // other ip
  assert.equal(await rateLimited(ip(2), 'k-other', 3, opts), false) // other kind
})

test('local fallback resets in the next minute window', async () => {
  const req = reqWith({ 'x-forwarded-for': '10.9.9.9' })
  const t0 = 17_000 * 60_000 // aligned to a minute boundary
  const o = (now) => ({ ...noRedis, localFallback: true, now })
  for (let i = 0; i < 3; i++) await rateLimited(req, 'k-reset', 3, o(t0 + 1000))
  assert.equal(await rateLimited(req, 'k-reset', 3, o(t0 + 59_000)), true)
  assert.equal(await rateLimited(req, 'k-reset', 3, o(t0 + 60_000)), false) // new window
  assert.equal(await rateLimited(req, 'k-reset', 3, o(t0 + 61_000)), false)
})

test('rateLimited falls back to the local counter when Redis errors, and uses Redis when it works', async () => {
  const req = reqWith({ 'x-forwarded-for': '10.8.8.8' })
  const broken = { incr: async () => { throw new Error('upstash down') }, expire: async () => {} }
  const t0 = 17_100 * 60_000
  const seq = []
  for (let i = 0; i < 3; i++) seq.push(await rateLimited(req, 'k-err', 2, { redis: broken, localFallback: true, now: t0 }))
  assert.deepEqual(seq, [false, false, true])
  assert.equal(await rateLimited(req, 'k-err2', 1, { redis: broken, now: t0 }), false) // legacy behaviour without fallback
  assert.equal(await rateLimited(req, 'k-err2', 1, { redis: broken, now: t0 }), false)

  const calls = []
  let n = 0
  const good = { incr: async (k) => { calls.push(['incr', k]); return ++n }, expire: async (k, s) => { calls.push(['expire', k, s]) } }
  assert.equal(await rateLimited(req, 'k-redis', 1, { redis: good, localFallback: true, now: t0 }), false)
  assert.equal(await rateLimited(req, 'k-redis', 1, { redis: good, localFallback: true, now: t0 }), true)
  assert.equal(calls[0][0], 'incr')
  assert.match(calls[0][1], /^rl:k-redis:10\.8\.8\.8:\d+$/)
  assert.equal(calls.filter((c) => c[0] === 'expire').length, 1) // only on the first hit
})

test('windowHit and windowCount: failure counters over a custom window', async () => {
  const o = (now) => ({ redis: null, localFallback: true, now })
  const W = 15 * 60_000
  const t0 = 17_220 * 60_000 // multiple of 15 min
  assert.equal(await windowCount('lf:a', W, o(t0)), 0)
  for (let i = 1; i <= 10; i++) assert.equal(await windowHit('lf:a', W, o(t0 + i * 1000)), i)
  assert.equal(await windowCount('lf:a', W, o(t0 + 20_000)), 10) // peeking does not increment
  assert.equal(await windowCount('lf:a', W, o(t0 + 20_000)), 10)
  assert.equal(await windowCount('lf:a', W, o(t0 + W)), 0) // next window
  assert.equal(await windowCount('lf:b', W, o(t0)), 0)
  assert.equal(await windowHit('lf:a', W, { redis: null, now: t0 }), 0) // no fallback, no Redis: no counter
})

test('local limiter is bounded', async () => {
  const o = { redis: null, localFallback: true, now: 17_300 * 60_000 }
  for (let i = 0; i < 6000; i++) await windowHit(`bound:${i}`, 60_000, o)
  assert.ok(localWindowSize() <= 5000, String(localWindowSize()))
  assert.equal(await windowCount('bound:5999', 60_000, o), 1) // newest entries survive eviction
})

test('retryAfterSecs and tooMany build a 429 with Retry-After', async () => {
  assert.equal(retryAfterSecs(60_000, 120_000), 60)
  assert.equal(retryAfterSecs(60_000, 120_000 + 59_500), 1)
  assert.equal(retryAfterSecs(900_000, 900_000 * 5 + 1), 900)
  const res = tooMany(60, 'Too many attempts, try again later')
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '60')
  assert.deepEqual(await res.json(), { error: 'Too many attempts, try again later' })
})

function fakeCollections() {
  const log = { indexes: [], inserted: {}, queries: [] }
  const col = (name) => ({
    createIndex: async (spec, opts) => { log.indexes.push([name, spec, opts]) },
    insertOne: async (doc) => { (log.inserted[name] ??= []).push(doc); doc._id = 'oid' },
    findOne: async (q) => { log.queries.push([name, q]); return null },
    deleteOne: async () => {},
    updateOne: async () => {},
  })
  const cols = {}
  return { log, client: { db: () => ({ collection: (n) => (cols[n] ??= col(n)) }) } }
}

test('mongo store creates the users and sessions indexes (unique + TTL)', async () => {
  const { log, client } = fakeCollections()
  const store = createMongoStore(client, 'fake')
  await store.getUserByEmail('a@b.co')
  const find = (name, spec) => log.indexes.find(([n, s]) => n === name && JSON.stringify(s) === JSON.stringify(spec))
  assert.equal(find('users', { email: 1 })[2].unique, true)
  assert.equal(find('sessions', { tokenHash: 1 })[2].unique, true)
  assert.deepEqual(find('sessions', { expiresAt: 1 })[2], { expireAfterSeconds: 0 })
})

test('mongo store keeps session expiry as a Date for the TTL index and reads it back as ms', async () => {
  const { log, client } = fakeCollections()
  const store = createMongoStore(client, 'fake')
  const now = Date.now()
  await store.createSession({ tokenHash: 'h', userId: 'u_1', createdAt: now, lastSeenAt: now, expiresAt: now + DAY })
  const written = log.inserted.sessions[0]
  assert.ok(written.expiresAt instanceof Date)
  assert.equal(written.expiresAt.getTime(), now + DAY)
  await store.getSessionByTokenHash('h', now)
  const [, q] = log.queries.at(-1)
  assert.equal(q.tokenHash, 'h')
  assert.ok(q.expiresAt.$gt instanceof Date)
  assert.equal(q.expiresAt.$gt.getTime(), now)
})

test('mongo store normalises emails on write and lookup', async () => {
  const { log, client } = fakeCollections()
  const store = createMongoStore(client, 'fake')
  const u = await store.createUser(mkUser({ email: ' Ann@Example.COM ' }))
  assert.equal(log.inserted.users[0].email, 'ann@example.com')
  assert.equal('_id' in u, false)
  await store.getUserByEmail('ANN@Example.com')
  assert.deepEqual(log.queries.at(-1), ['users', { email: 'ann@example.com' }])
})

test('credential counters live in their own map and fail closed instead of evicting a live counter', async () => {
  const W = 15 * 60_000
  const t0 = 17_400 * 60_000
  const o = { redis: null, localFallback: true, credential: true, now: t0 }
  const before = credWindowSize()
  assert.equal(await windowHit('credtest:victim', W, o), 1)
  assert.equal(await windowHit('credtest:victim', W, o), 2)
  // generic traffic never touches the credential map
  const generic = { redis: null, localFallback: true, now: t0 }
  for (let i = 0; i < 6000; i++) await windowHit(`generic-flood:${i}`, 60_000, generic)
  assert.equal(credWindowSize(), before + 1)
  assert.equal(await windowCount('credtest:victim', W, o), 2)
  // fill the credential map with live entries: new keys are treated as limited, existing counters survive
  let i = 0
  while (credWindowSize() < 20000) await windowHit(`credtest:fill:${i++}`, W, o)
  assert.equal(await windowHit('credtest:newcomer', W, o), Infinity)
  assert.equal(credWindowSize(), 20000)
  assert.equal(await windowHit('credtest:victim', W, o), 3) // not evicted
  assert.equal(await windowCount('credtest:newcomer', W, o), 0)
  // once the window passes, the expired entries are evicted and new keys are counted again
  assert.equal(await windowHit('credtest:newcomer', W, { ...o, now: t0 + W }), 1)
  assert.ok(credWindowSize() < 20000)
})

test('windowClear forgets a counter locally and deletes the Redis key', async () => {
  const W = 15 * 60_000
  const t0 = 17_500 * 60_000
  const o = { redis: null, localFallback: true, credential: true, now: t0 }
  await windowHit('clear:me', W, o)
  await windowHit('clear:me', W, o)
  await windowClear('clear:me', W, { redis: null, now: t0 })
  assert.equal(await windowCount('clear:me', W, o), 0)
  const dels = []
  await windowClear('clear:me', W, { redis: { del: async (k) => { dels.push(k) } }, now: t0 })
  assert.deepEqual(dels, [`rl:clear:me:${Math.floor(t0 / W)}`])
  await windowClear('clear:me', W, { redis: { del: async () => { throw new Error('down') } }, now: t0 }) // swallowed
})

test('clientIp prefers x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for entry', () => {
  const ip = (h) => clientIp(reqWith(h))
  assert.equal(ip({ 'x-vercel-forwarded-for': '1.1.1.1, 9.9.9.9', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }), '1.1.1.1')
  assert.equal(ip({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }), '2.2.2.2')
  assert.equal(ip({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }), '3.3.3.3')
  assert.equal(ip({}), 'local')
})

test('rateLimited keeps the legacy Redis key format', async () => {
  const keys = []
  const redis = { incr: async (k) => { keys.push(k); return 1 }, expire: async () => {} }
  await rateLimited(reqWith({ 'x-forwarded-for': '7.7.7.7, 8.8.8.8' }), 'kind', 5, { redis, now: 120_000 })
  assert.deepEqual(keys, ['rl:kind:7.7.7.7:2'])
})

test('memory store drops an expired session when it is looked up and indexes users by id', async () => {
  const state = { boards: new Map(), items: new Map(), people: new Map() }
  const s = createMemoryStore(state)
  const now = Date.now()
  await s.createSession({ tokenHash: 'h-old', userId: 'u_1', createdAt: now - 2 * DAY, lastSeenAt: now - 2 * DAY, expiresAt: now - DAY })
  assert.equal(state.sessions.size, 1)
  assert.equal(await s.getSessionByTokenHash('h-old', now), null)
  assert.equal(state.sessions.size, 0)
  const u = await s.createUser(mkUser())
  assert.equal(state.usersById.get(u.id).email, 'ann@example.com')
})
