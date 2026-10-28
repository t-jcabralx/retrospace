import test from 'node:test'
import assert from 'node:assert/strict'

// authorize() reads sessions through getStore(); force the in-memory store whatever the shell has set.
for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { authorize, HttpError, accessCookieName, buildAccessCookie, hasAccessCookie, requireOwner, viewerBoard } = await import('../src/lib/access.js')
const { createSessionFor, newUserId } = await import('../src/lib/auth.js')
const { hashPassword } = await import('../src/lib/password.js')
const { getStore } = await import('../src/lib/store.js')

const CODE = 'ABC234'
const store = getStore()
const PASSCODE = 'open sesame'
const hashA = await hashPassword(PASSCODE)
const hashB = await hashPassword('another one')

async function account(name) {
  const user = await store.createUser({ id: newUserId(), email: `${name}-${Math.random().toString(16).slice(2)}@example.com`, name, passwordHash: 'x', createdAt: Date.now() })
  const { cookie } = await createSessionFor(user.id, Date.now(), store)
  return { user, session: cookie.split(';')[0] }
}
const owner = await account('owner')
const stranger = await account('stranger')

const board = (extra = {}) => ({ code: CODE, ownerId: owner.user.id, status: 'open', revoked: false, passcodeHash: null, locked: false, ...extra })
const req = (...cookies) => new Request('http://localhost/api/x', { headers: cookies.length ? { cookie: cookies.join('; ') } : {} })
const accessCookie = (b) => buildAccessCookie(b).split(';')[0]
const denies = (p, status, message) => assert.rejects(p, (e) => e instanceof HttpError && e.status === status && e.message === message)

test('HttpError carries a status and a message', () => {
  const e = new HttpError(418, 'teapot')
  assert.ok(e instanceof Error)
  assert.deepEqual([e.status, e.message], [418, 'teapot'])
})

test('an open board: owner and guest both pass, with the right role', async () => {
  const o = await authorize(req(owner.session), board())
  assert.equal(o.role, 'owner')
  assert.equal(o.user.id, owner.user.id)
  const g = await authorize(req(), board())
  assert.equal(g.role, 'guest')
  assert.equal(g.user, undefined)
  const s = await authorize(req(stranger.session), board())
  assert.equal(s.role, 'guest') // signed in, but not this board's owner
  assert.equal(s.user.id, stranger.user.id)
})

test('write on an open board is allowed for a guest', async () => {
  assert.equal((await authorize(req(), board(), { write: true })).role, 'guest')
})

test('a closed board: guests may read but not write; the owner may do both', async () => {
  const closed = board({ status: 'closed' })
  assert.equal((await authorize(req(), closed)).role, 'guest')
  await denies(authorize(req(), closed, { write: true }), 403, 'Board is closed')
  await denies(authorize(req(stranger.session), closed, { write: true }), 403, 'Board is closed')
  assert.equal((await authorize(req(owner.session), closed, { write: true })).role, 'owner')
})

test('a revoked board: guests are refused for read and write; the owner still passes', async () => {
  const revoked = board({ revoked: true })
  await denies(authorize(req(), revoked), 403, 'This link was revoked')
  await denies(authorize(req(), revoked, { write: true }), 403, 'This link was revoked')
  assert.equal((await authorize(req(owner.session), revoked, { write: true })).role, 'owner')
  const both = board({ revoked: true, status: 'closed', passcodeHash: hashA })
  await denies(authorize(req(accessCookie(both)), both), 403, 'This link was revoked') // revoked wins over a good cookie
  assert.equal((await authorize(req(owner.session), both, { write: true })).role, 'owner')
})

test('a passcode board: a guest needs the access cookie (401), the owner does not', async () => {
  const b = board({ passcodeHash: hashA })
  await denies(authorize(req(), b), 401, 'Passcode required')
  await denies(authorize(req(), b, { write: true }), 401, 'Passcode required')
  await denies(authorize(req(stranger.session), b), 401, 'Passcode required')
  assert.equal((await authorize(req(owner.session), b)).role, 'owner')
  assert.equal((await authorize(req(accessCookie(b)), b)).role, 'guest')
  assert.equal((await authorize(req(accessCookie(b)), b, { write: true })).role, 'guest')
})

test('passcode + closed: the cookie opens reading, writing still says closed', async () => {
  const b = board({ passcodeHash: hashA, status: 'closed' })
  assert.equal((await authorize(req(accessCookie(b)), b)).role, 'guest')
  await denies(authorize(req(accessCookie(b)), b, { write: true }), 403, 'Board is closed')
  await denies(authorize(req(), b, { write: true }), 401, 'Passcode required') // the passcode gate comes first
})

test('wrong, malformed and foreign access cookies are refused', async () => {
  const b = board({ passcodeHash: hashA })
  const name = accessCookieName(CODE)
  for (const v of ['', 'nope', 'a'.repeat(64), `${'0'.repeat(63)}`, 'zz'.repeat(32)]) {
    await denies(authorize(req(`${name}=${v}`), b), 401, 'Passcode required')
  }
  // a cookie earned on another board is useless here, and so is the same cookie under this board's name
  const other = board({ code: 'ZZZZ22', passcodeHash: hashA })
  await denies(authorize(req(`${name}=${accessCookie(other).split('=')[1]}`), b), 401, 'Passcode required')
  await denies(authorize(req(accessCookie(other)), b), 401, 'Passcode required')
})

test('changing or removing the passcode invalidates a cookie earned with the old one', async () => {
  const before = board({ passcodeHash: hashA })
  const cookie = accessCookie(before)
  assert.equal((await authorize(req(cookie), before)).role, 'guest')
  const changed = board({ passcodeHash: hashB })
  await denies(authorize(req(cookie), changed), 401, 'Passcode required')
  // the same passcode set again gets a fresh salt, so it also starts over
  const reset = board({ passcodeHash: await hashPassword(PASSCODE) })
  await denies(authorize(req(cookie), reset), 401, 'Passcode required')
  // removing the passcode: no cookie needed any more; setting one again does not revive the old cookie
  assert.equal((await authorize(req(), board())).role, 'guest')
  await denies(authorize(req(cookie), board({ passcodeHash: hashB })), 401, 'Passcode required')
})

test('the cookie value is an HMAC: never the passcode, never the hash, never a hash part', () => {
  const b = board({ passcodeHash: hashA })
  const value = buildAccessCookie(b).split(';')[0].split('=')[1]
  assert.match(value, /^[0-9a-f]{64}$/)
  assert.notEqual(value, PASSCODE)
  assert.ok(!buildAccessCookie(b).includes(PASSCODE))
  assert.ok(!buildAccessCookie(b).includes(hashA))
  for (const part of hashA.split('$').slice(4)) assert.ok(!buildAccessCookie(b).includes(part))
  assert.notEqual(value, buildAccessCookie(board({ passcodeHash: hashB })).split('=')[1].split(';')[0])
})

test('the cookie is not tied to a guest uid: the same value works for any request', async () => {
  const b = board({ passcodeHash: hashA })
  assert.equal(hasAccessCookie(req(accessCookie(b)), b), true)
  assert.equal(hasAccessCookie(req('km_uid=KM-2222-3333-4444', accessCookie(b)), b), true)
})

test('cookie attributes: HttpOnly, SameSite=Lax, Path=/, 30 days, Secure only in production', () => {
  const b = board({ passcodeHash: hashA })
  const flags = buildAccessCookie(b).split(';').map((s) => s.trim())
  assert.equal(flags[0].split('=')[0], 'rs_a_ABC234')
  for (const f of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(flags.includes(f), f)
  assert.ok(!flags.includes('Secure'))
  const saved = [process.env.NODE_ENV, process.env.RT_SECRET]
  process.env.NODE_ENV = 'production'
  process.env.RT_SECRET = 'prod-secret' // production refuses to sign without one
  try {
    assert.ok(buildAccessCookie(b).split(';').map((s) => s.trim()).includes('Secure'))
  } finally {
    process.env.NODE_ENV = saved[0]
    if (saved[1] === undefined) delete process.env.RT_SECRET
    else process.env.RT_SECRET = saved[1]
  }
})

test('the signing secret is the one rt.js uses, so RT_SECRET changes invalidate access cookies', async () => {
  const b = board({ passcodeHash: hashA })
  const cookie = accessCookie(b)
  const saved = process.env.RT_SECRET
  process.env.RT_SECRET = 'a different secret'
  try {
    await denies(authorize(req(cookie), b), 401, 'Passcode required')
  } finally {
    if (saved === undefined) delete process.env.RT_SECRET
    else process.env.RT_SECRET = saved
  }
  assert.equal((await authorize(req(cookie), b)).role, 'guest')
})

test('a board without an owner id never matches a signed-out guest', async () => {
  assert.equal((await authorize(req(), board({ ownerId: undefined }))).role, 'guest')
  assert.equal((await authorize(req(), board({ ownerId: null }))).role, 'guest')
})

test('requireOwner: 401 with no session, 403 for another account, the user for the owner', async () => {
  await denies(requireOwner(req(), board()), 401, 'Sign in')
  await denies(requireOwner(req(stranger.session), board()), 403, 'Not the owner')
  assert.equal((await requireOwner(req(owner.session), board())).id, owner.user.id)
})

test('viewerBoard: only the owner sees ownerId and createdBy; nobody sees a hash', () => {
  const full = board({ passcodeHash: hashA, createdBy: owner.user.id, title: 'T' })
  const asOwner = viewerBoard(full, 'owner')
  assert.deepEqual([asOwner.ownerId, asOwner.createdBy, asOwner.title], [owner.user.id, owner.user.id, 'T'])
  const asGuest = viewerBoard(full, 'guest')
  assert.equal(asGuest.title, 'T')
  for (const k of ['passcodeHash', 'ownerKeyHash']) assert.equal(k in asOwner, false, `owner view has ${k}`)
  for (const k of ['ownerId', 'createdBy', 'passcodeHash', 'ownerKeyHash']) assert.equal(k in asGuest, false, `guest view has ${k}`)
  assert.ok('passcodeHash' in full, 'the input is not mutated')
  assert.equal(viewerBoard(null, 'guest'), null)
})

test('in production without RT_SECRET or an Upstash token, access cookies cannot be made or checked', async () => {
  const keys = ['RT_SECRET', 'UPSTASH_REDIS_REST_TOKEN', 'NODE_ENV']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const b = board({ passcodeHash: hashA })
  try {
    delete process.env.RT_SECRET
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.NODE_ENV = 'production'
    assert.throws(() => buildAccessCookie(b), /RT_SECRET must be set in production/)
    assert.throws(() => hasAccessCookie(req(`${accessCookieName(CODE)}=${'a'.repeat(64)}`), b), /RT_SECRET must be set in production/)
    process.env.RT_SECRET = 'prod-secret'
    assert.equal(hasAccessCookie(req(accessCookie(b)), b), true)
  } finally {
    for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  }
})
