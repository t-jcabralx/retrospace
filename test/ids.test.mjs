import test from 'node:test'
import assert from 'node:assert/strict'
import { newUid, newCode, isUid, isCode, isCid, cleanName } from '../src/lib/ids.js'

test('generated ids match their formats and are unique', () => {
  const uids = new Set()
  for (let i = 0; i < 200; i++) {
    const u = newUid()
    assert.match(u, /^KM-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
    assert.equal(isUid(u), true)
    assert.equal(isCode(newCode()), true)
    uids.add(u)
  }
  assert.equal(uids.size, 200)
  assert.equal(newCode().length, 6)
})

test('isUid / isCode reject malformed values', () => {
  for (const v of ['', 'KM-AAAA-AAAA-AAA0', 'KM-2222-2222-222', null, 5, 'km-2222-2222-2222']) assert.equal(isUid(v), false, String(v))
  for (const v of ['', 'ABCDE', 'ABCDEFG', 'ABCDE0', 'ABCDEI', null]) assert.equal(isCode(v), false, String(v))
})

test('isCid accepts short word-character ids and rejects the rest', () => {
  for (const v of ['c0123456789abcdef01234567', 'tab-1_A', 'x'.repeat(40)]) assert.equal(isCid(v), true, v)
  for (const v of ['', 'x'.repeat(41), 'a b', 'a/b', 'a.b', '<x>', null, undefined, 5, ['a']]) assert.equal(isCid(v), false, String(v))
})

test('cleanName', () => {
  assert.equal(cleanName('  Ana\u0000 \n María  '), 'Ana María')
  assert.equal(cleanName('x'.repeat(40)).length, 24)
  assert.equal(cleanName(''), 'Guest')
  assert.equal(cleanName('\u0007\n'), 'Guest')
  assert.equal(cleanName(undefined), 'Guest')
  assert.equal(cleanName(42), 'Guest')
  assert.equal(Array.from(cleanName('😀'.repeat(30))).length, 24)
})

test('stripControl replaces control characters with spaces and collapses whitespace', async () => {
  const { stripControl } = await import('../src/lib/ids.js')
  assert.equal(stripControl('  a\u0000b \n\t c d  '), 'a b c d')
  assert.equal(stripControl(''), '')
})
