import test from 'node:test'
import assert from 'node:assert/strict'
import { revealPhase, revealEffect, firstName, revealStage } from '../src/ui/revealPhase.js'
import { BOARD_TEMPLATES } from '../src/lib/templates.js'

const NOW = Date.parse('2030-05-01T12:00:00.000Z')
const at = (ms) => ({ revealAt: new Date(NOW + ms).toISOString() })

test('revealPhase: no reveal time means ready', () => {
  assert.equal(revealPhase({ revealAt: null }, NOW, 'guest', 0), 'ready')
  assert.equal(revealPhase({}, NOW, 'guest', 0), 'ready')
  assert.equal(revealPhase(null, NOW, 'guest', 0), 'ready')
})

test('revealPhase: a future time is a countdown for a guest, ready for the owner', () => {
  assert.equal(revealPhase(at(60_000), NOW, 'guest', 0), 'countdown')
  assert.equal(revealPhase(at(60_000), NOW, undefined, 0), 'countdown')
  assert.equal(revealPhase(at(60_000), NOW, 'owner', 0), 'ready')
})

test('revealPhase: the boundary is inclusive (exactly revealAt is ready)', () => {
  assert.equal(revealPhase(at(1), NOW, 'guest', 0), 'countdown')
  assert.equal(revealPhase(at(0), NOW, 'guest', 0), 'ready')
  assert.equal(revealPhase(at(-1), NOW, 'guest', 0), 'ready')
})

test('revealPhase: the server offset (server minus client) moves the boundary', () => {
  // the client clock is 5 s behind the server: the reveal 3 s from "now" has already happened on the server
  assert.equal(revealPhase(at(3000), NOW, 'guest', 5000), 'ready')
  assert.equal(revealPhase(at(3000), NOW, 'guest', 2999), 'countdown')
  assert.equal(revealPhase(at(3000), NOW, 'guest', 3000), 'ready')
  // the client clock is ahead of the server
  assert.equal(revealPhase(at(-3000), NOW, 'guest', -5000), 'countdown')
})

test('revealPhase: Date objects, epoch numbers and junk are tolerated', () => {
  assert.equal(revealPhase({ revealAt: new Date(NOW + 5000) }, NOW, 'guest', 0), 'countdown')
  assert.equal(revealPhase({ revealAt: NOW + 5000 }, NOW, 'guest', 0), 'countdown')
  assert.equal(revealPhase({ revealAt: 'not a date' }, NOW, 'guest', 0), 'ready')
  assert.equal(revealPhase(at(5000), NOW, 'guest', undefined), 'countdown')
  assert.equal(revealPhase(at(5000), NOW, 'guest', NaN), 'countdown')
})

test('revealEffect follows the occasion: birthday balloons, promotion/congrats/anniversary fireworks, the rest confetti', () => {
  const expected = { birthday: 'balloons', promotion: 'fireworks', congrats: 'fireworks', anniversary: 'fireworks', farewell: 'confetti', welcome: 'confetti', baby: 'confetti', thanks: 'confetti' }
  assert.deepEqual(Object.keys(BOARD_TEMPLATES.celebration).sort(), Object.keys(expected).sort())
  for (const [key, t] of Object.entries(BOARD_TEMPLATES.celebration)) {
    assert.equal(revealEffect({ type: 'celebration', template: key, theme: t.theme }), expected[key], key)
    assert.equal(revealEffect({ type: 'celebration', template: key }), expected[key], `${key} without a stored theme`)
  }
})

test('revealEffect prefers the board theme, ignores an unknown effect, and falls back to confetti', () => {
  assert.equal(revealEffect({ type: 'celebration', template: 'birthday', theme: { effect: 'fireworks' } }), 'fireworks')
  assert.equal(revealEffect({ type: 'celebration', template: 'birthday', theme: { effect: 'lasers' } }), 'balloons')
  assert.equal(revealEffect({ type: 'nope', template: 'x' }), 'confetti')
  assert.equal(revealEffect(null), 'confetti')
})

test('firstName takes the first word of the recipient name', () => {
  assert.equal(firstName('Sam Rivera'), 'Sam')
  assert.equal(firstName('  Ana  '), 'Ana')
  assert.equal(firstName('Madonna'), 'Madonna')
  assert.equal(firstName({ name: 'Zed Q' }), 'Zed')
  assert.equal(firstName(''), '')
  assert.equal(firstName(null), '')
})

test('revealStage: where the page is, from the state machine inputs', () => {
  assert.equal(revealStage({ phase: 'countdown', step: 'intro' }), 'countdown')
  assert.equal(revealStage({ phase: 'ready', step: 'intro' }), 'intro')
  assert.equal(revealStage({ phase: 'ready', step: 'slides' }), 'slides')
  assert.equal(revealStage({ phase: 'ready', step: 'board' }), 'board')
  assert.equal(revealStage({ phase: 'ready', step: 'bogus' }), 'intro')
})
