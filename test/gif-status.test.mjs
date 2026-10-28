import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyGifError, gifErrorMessage, createGate } from '../src/ui/gifStatus.js'

test('classifyGifError: 429 and quota are busy, a network failure is offline, other HTTP answers are unavailable', () => {
  assert.equal(classifyGifError({ status: 429 }), 'busy')
  assert.equal(classifyGifError(Object.assign(new Error('Too Many Requests'), { status: 429 })), 'busy')
  assert.equal(classifyGifError({ status: 403, message: 'API rate limit exceeded' }), 'busy')
  assert.equal(classifyGifError(new Error('@giphy/js-fetch-api: rate limit reached')), 'busy')
  assert.equal(classifyGifError(new TypeError('Failed to fetch')), 'offline')
  assert.equal(classifyGifError({ status: 0, message: 'Failed to fetch' }), 'offline')
  assert.equal(classifyGifError({ status: 500 }), 'unavailable')
  assert.equal(classifyGifError({ status: 401 }), 'unavailable')
  assert.equal(classifyGifError(undefined), 'offline')
})

test('classifyGifError treats the browser being offline as offline whatever the error says', () => {
  assert.equal(classifyGifError({ status: 429 }, { online: false }), 'offline')
  assert.equal(classifyGifError({ status: 500 }, { online: false }), 'offline')
})

test('gifErrorMessage: plain words for each kind', () => {
  assert.match(gifErrorMessage('busy'), /busy right now.*try again in a minute/i)
  assert.match(gifErrorMessage('offline'), /check your connection/i)
  assert.match(gifErrorMessage('unavailable'), /Giphy/)
  assert.match(gifErrorMessage('anything else'), /Giphy/)
  for (const k of ['busy', 'offline', 'unavailable']) assert.match(gifErrorMessage(k), /paste/i, 'always points at the paste-a-link way')
})

test('a gate lets only the newest generation report; an older one (slow response) is ignored', () => {
  const gate = createGate()
  const a = gate.next()
  assert.equal(gate.isCurrent(a), true)
  const b = gate.next()
  assert.equal(gate.isCurrent(a), false, 'superseded')
  assert.equal(gate.isCurrent(b), true)
  gate.close()
  assert.equal(gate.isCurrent(b), false, 'unmounted')
  assert.equal(gate.isCurrent(gate.next()), false, 'a closed gate stays closed')
})
