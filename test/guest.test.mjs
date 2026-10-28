import test from 'node:test'
import assert from 'node:assert/strict'
import { readGuest, mintGuest, ensureGuest, GUEST_COOKIE, publicId, publicIdForUser, boardId } from '../src/lib/guest.js'
import { isUid, newUid } from '../src/lib/ids.js'

const reqWith = (cookie) => new Request('http://localhost/x', { headers: cookie === undefined ? {} : { cookie } })
const value = (setCookie) => setCookie.split(';')[0].slice(GUEST_COOKIE.length + 1)
const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  try { return fn() } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
}

test('mintGuest returns a fresh uid and a hardened cookie; readGuest round-trips it', () => {
  const { uid, cookie } = mintGuest()
  assert.ok(isUid(uid))
  assert.match(cookie, /^rs_g=KM-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}\.[0-9a-f]{32};/)
  for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000']) assert.ok(cookie.includes(attr), attr)
  assert.equal(cookie.includes('Secure'), false, 'not in dev')
  assert.equal(readGuest(reqWith(cookie.split(';')[0])), uid)
  assert.notEqual(mintGuest().uid, uid)
})

test('the Secure attribute is added in production', () => {
  withEnv({ NODE_ENV: 'production', RT_SECRET: 'prod-secret' }, () => assert.ok(mintGuest().cookie.includes('; Secure')))
})

test('readGuest finds its cookie among others, in any position', () => {
  const { uid, cookie } = mintGuest()
  const mine = cookie.split(';')[0]
  assert.equal(readGuest(reqWith(`a=1; ${mine}; b=2`)), uid)
  assert.equal(readGuest(reqWith(`${mine}`)), uid)
  assert.equal(readGuest(reqWith(`km_uid=${uid}; rs_session=zzz`)), null, 'the old client cookie proves nothing')
})

test('a tampered uid or hmac, a wrong secret, a malformed or empty cookie are all null (never a throw)', () => {
  const { uid, cookie } = mintGuest()
  const v = value(cookie)
  const other = newUid()
  const [, mac] = v.split('.')
  const bad = [
    `${other}.${mac}`, // someone else's uid with my mac
    `${uid}.${'0'.repeat(32)}`, `${uid}.${mac.slice(0, 31)}`, `${uid}.${mac}0`, `${uid}.${mac.toUpperCase()}`,
    uid, `${uid}.`, `.${mac}`, '', '.', `${uid}.${mac}.${mac}`, `KM-AAAA.${mac}`, `${uid.toLowerCase()}.${mac}`, 'x'.repeat(5000), `${uid};${mac}`,
  ]
  for (const b of bad) assert.equal(readGuest(reqWith(`rs_g=${b}`)), null, b.slice(0, 60))
  assert.equal(readGuest(reqWith(undefined)), null)
  assert.equal(readGuest(reqWith('')), null)
  assert.equal(readGuest(reqWith('rs_g')), null)
  assert.equal(readGuest(reqWith('rs_g=')), null)
  assert.equal(readGuest(reqWith('%%%; rs_g==; ;;')), null)
  const rotated = withEnv({ RT_SECRET: 'a different secret' }, () => readGuest(reqWith(`rs_g=${v}`)))
  assert.equal(rotated, null, 'a cookie signed with another secret')
})

test('readGuest never throws, even when the secret is missing in production', () => {
  const { cookie } = mintGuest()
  withEnv({ NODE_ENV: 'production', RT_SECRET: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }, () => {
    assert.equal(readGuest(reqWith(cookie.split(';')[0])), null)
  })
})

test('ensureGuest keeps a valid guest and mints exactly once otherwise', () => {
  const first = ensureGuest(reqWith(undefined))
  assert.ok(isUid(first.uid))
  assert.ok(first.setCookie.startsWith(`rs_g=${first.uid}.`))
  const again = ensureGuest(reqWith(first.setCookie.split(';')[0]))
  assert.deepEqual(again, { uid: first.uid })
  assert.equal('setCookie' in again, false)
  const forged = ensureGuest(reqWith(`rs_g=${first.uid}.${'0'.repeat(32)}`))
  assert.notEqual(forged.uid, first.uid, 'a forged cookie gets a new identity')
  assert.ok(forged.setCookie)
})

test('publicId is a KM-format id, stable per (cookie uid, board), and unrelated across boards and cookies', () => {
  const { uid } = mintGuest()
  const a = publicId('ABC234', uid)
  assert.ok(isUid(a))
  assert.equal(publicId('ABC234', uid), a)
  assert.notEqual(publicId('ZZZ234', uid), a, 'the same browser has a different id on another board')
  assert.notEqual(publicId('ABC234', mintGuest().uid), a)
  assert.notEqual(a, uid, 'the cookie uid itself is never the public id')
  assert.equal(a.includes(uid.slice(3)), false)
  const seen = new Set()
  for (let i = 0; i < 500; i++) seen.add(publicId('ABC234', mintGuest().uid))
  assert.equal(seen.size, 500)
})

test('publicId depends on the server secret', () => {
  const { uid } = mintGuest()
  const a = publicId('ABC234', uid)
  const b = withEnv({ RT_SECRET: 'another secret' }, () => publicId('ABC234', uid))
  assert.notEqual(a, b)
})

test('publicIdForUser is per account and board, independent of any cookie, and in a different namespace', () => {
  const o = publicIdForUser('ABC234', 'u_0123456789abcdef')
  assert.ok(isUid(o))
  assert.equal(publicIdForUser('ABC234', 'u_0123456789abcdef'), o)
  assert.notEqual(publicIdForUser('ZZZ234', 'u_0123456789abcdef'), o)
  assert.notEqual(publicIdForUser('ABC234', 'u_fedcba9876543210'), o)
  assert.notEqual(publicId('ABC234', 'u_0123456789abcdef'), o)
})

test('boardId: owners by account (no cookie needed), guests by cookie, nobody without one', () => {
  const g = mintGuest()
  const withCookie = reqWith(g.cookie.split(';')[0])
  const owner = { role: 'owner', user: { id: 'u_0123456789abcdef' } }
  assert.equal(boardId(reqWith(undefined), 'ABC234', owner), publicIdForUser('ABC234', 'u_0123456789abcdef'))
  assert.equal(boardId(withCookie, 'ABC234', owner), publicIdForUser('ABC234', 'u_0123456789abcdef'), 'a cookie changes nothing for the owner')
  assert.equal(boardId(withCookie, 'ABC234', { role: 'guest' }), publicId('ABC234', g.uid))
  assert.equal(boardId(withCookie, 'ABC234', { role: 'guest', user: { id: 'u_0123456789abcdef' } }), publicId('ABC234', g.uid), 'a signed-in non-owner is just a guest')
  assert.equal(boardId(reqWith(undefined), 'ABC234', { role: 'guest' }), null)
  assert.equal(boardId(reqWith(`rs_g=${g.uid}.${'0'.repeat(32)}`), 'ABC234', { role: 'guest' }), null)
})
