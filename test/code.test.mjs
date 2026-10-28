import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCode, codeProblem, retryAfterSeconds, interpretJoin } from '../src/lib/code.js'
import { isCode } from '../src/lib/ids.js'

test('normalizeCode upper-cases and strips spaces, dashes and underscores', () => {
  assert.equal(normalizeCode('k7m-2qx'), 'K7M2QX')
  assert.equal(normalizeCode('  k7m 2qx  '), 'K7M2QX')
  assert.equal(normalizeCode('K7M_2QX'), 'K7M2QX')
  assert.equal(normalizeCode('k7m\u20132qx'), 'K7M2QX') // en dash from a rich-text paste
  assert.equal(normalizeCode('k7m\u00a02qx'), 'K7M2QX') // non-breaking space
  assert.equal(normalizeCode('k7m\u200b2qx'), 'K7M2QX') // zero-width space
  assert.equal(normalizeCode('k7m2qx\n'), 'K7M2QX')
  for (const sep of ['\u2010', '\u2014', '\u200c', '\u200d', '\ufeff']) assert.equal(normalizeCode(`k7m${sep}2qx`), 'K7M2QX', sep.codePointAt(0).toString(16))
})

test('normalizeCode leaves other characters alone so isCode can reject them', () => {
  assert.equal(normalizeCode('o0l1i-ab'), 'O0L1IAB')
  assert.equal(isCode(normalizeCode('o0l1ia')), false)
  assert.equal(isCode(normalizeCode('k7m-2qx')), true)
  assert.equal(normalizeCode('k7m!2q'), 'K7M!2Q')
  assert.equal(isCode(normalizeCode('k7m!2q')), false)
})

test('normalizeCode is safe on non-strings', () => {
  for (const v of [undefined, null, 42, {}, []]) assert.equal(normalizeCode(v), '')
  assert.equal(normalizeCode(''), '')
})

test('codeProblem explains why a code is not valid', () => {
  assert.equal(codeProblem('K7M2QX'), null)
  assert.match(codeProblem(''), /Enter the 6-character code/)
  assert.match(codeProblem('K7M'), /6 characters/)
  assert.match(codeProblem('K7M2QXA'), /6 characters/)
  assert.match(codeProblem('K7M2Q0'), /0, 1, I, L or O/)
  assert.match(codeProblem('K7M2Q!'), /letters and numbers/)
})

test('retryAfterSeconds reads a Retry-After header value', () => {
  assert.equal(retryAfterSeconds('12'), 12)
  assert.equal(retryAfterSeconds('0'), 1)
  assert.equal(retryAfterSeconds('abc'), null)
  assert.equal(retryAfterSeconds(null), null)
  assert.equal(retryAfterSeconds('99999'), 3600)
})

test('interpretJoin maps API answers to messages and board info', () => {
  assert.deepEqual(interpretJoin(404, { exists: false }), { error: "We couldn't find a board with that code" })
  assert.deepEqual(interpretJoin(429, {}, 30), { error: 'Too many tries — wait 30 seconds' })
  assert.deepEqual(interpretJoin(429, {}, 1), { error: 'Too many tries — wait 1 second' })
  assert.deepEqual(interpretJoin(429, {}, null), { error: 'Too many tries — wait a moment' })
  assert.deepEqual(interpretJoin(200, { exists: true, revoked: true }), { error: 'This link was revoked' })
  assert.match(interpretJoin(500, {}).error, /Something went wrong/)
  assert.match(interpretJoin(400, {}).error, /6-character/)
  const open = interpretJoin(200, { exists: true, title: 'Retro', type: 'workshop', needsPasscode: true, closed: true, revoked: false })
  assert.deepEqual(open, { board: { title: 'Retro', type: 'workshop', needsPasscode: true, closed: true } })
})
