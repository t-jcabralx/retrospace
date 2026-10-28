import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword, dummyVerify } from '../src/lib/password.js'

test('hash then verify round trips', async () => {
  const stored = await hashPassword('correct horse battery')
  assert.match(stored, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.equal(await verifyPassword('correct horse battery', stored), true)
})

test('a wrong password does not verify', async () => {
  const stored = await hashPassword('correct horse battery')
  assert.equal(await verifyPassword('correct horse batterz', stored), false)
  assert.equal(await verifyPassword('', stored), false)
  assert.equal(await verifyPassword(undefined, stored), false)
  assert.equal(await verifyPassword(12345, stored), false)
})

test('two hashes of one password differ (random salt) and both verify', async () => {
  const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')])
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('same-password-1', a), true)
  assert.equal(await verifyPassword('same-password-1', b), true)
})

test('hash uses a 16-byte salt and a 64-byte key', async () => {
  const [, , , , salt, hash] = (await hashPassword('another-password')).split('$')
  assert.equal(Buffer.from(salt, 'base64').length, 16)
  assert.equal(Buffer.from(hash, 'base64').length, 64)
})

test('hashPassword rejects a non-string', async () => {
  await assert.rejects(hashPassword(undefined), TypeError)
})

test('malformed stored strings never verify and never throw', async () => {
  const good = await hashPassword('correct horse battery')
  const [, N, r, p, salt, hash] = good.split('$')
  const bad = [
    undefined, null, 42, {}, '', 'nope', 'scrypt', 'scrypt$16384$8$1', 'scrypt$16384$8$1$$',
    `bcrypt$${N}$${r}$${p}$${salt}$${hash}`,
    `scrypt$${N}$${r}$${p}$${salt}`, // missing hash
    `scrypt$${N}$${r}$${p}$${salt}$${hash}$extra`,
    `scrypt$abc$${r}$${p}$${salt}$${hash}`,
    `scrypt$${N}$${r}$${p}$!!!notbase64$${hash}`,
    `scrypt$${N}$${r}$${p}$${salt}$!!!notbase64`,
    `scrypt$${N}$${r}$${p}$${salt}$${Buffer.alloc(0).toString('base64')}`,
    `scrypt$${N}$${r}$${p}$${Buffer.alloc(0).toString('base64')}$${hash}`,
    `scrypt$${N}$${r}$${p}$${salt}$${randomBytes(1000).toString('base64')}`, // oversized hash
  ]
  for (const s of bad) assert.equal(await verifyPassword('correct horse battery', s), false, String(s))
})

test('out-of-range scrypt parameters are rejected', async () => {
  const good = await hashPassword('correct horse battery')
  const [, , , , salt, hash] = good.split('$')
  const withParams = (n, r, p) => `scrypt$${n}$${r}$${p}$${salt}$${hash}`
  assert.equal(await verifyPassword('correct horse battery', withParams(32768, 8, 1)), true) // control
  for (const [n, r, p] of [
    [262144, 8, 1], // N above 2^17
    [32767, 8, 1], // not a power of two
    [0, 8, 1], [1, 8, 1], [-32768, 8, 1],
    [32768, 17, 1], [32768, 0, 1], [32768, -1, 1],
    [32768, 8, 5], [32768, 8, 0],
    [32768.5, 8, 1],
  ]) {
    assert.equal(await verifyPassword('correct horse battery', withParams(n, r, p)), false, `${n}/${r}/${p}`)
  }
})

test('dummyVerify always resolves false without throwing', async () => {
  assert.equal(await dummyVerify('whatever-password'), false)
  assert.equal(await dummyVerify('dummy'), false)
  assert.equal(await dummyVerify(''), false)
  assert.equal(await dummyVerify(undefined), false)
})
