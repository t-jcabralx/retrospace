import test from 'node:test'
import assert from 'node:assert/strict'
import { hashKey } from '../src/lib/hash.js'

test('hashKey is a stable SHA-256 hex digest', () => {
  const h = hashKey('secret')
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(hashKey('secret'), h)
  assert.notEqual(hashKey('Secret'), h)
  assert.equal(hashKey('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
