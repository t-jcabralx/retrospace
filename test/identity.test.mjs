import test from 'node:test'
import assert from 'node:assert/strict'
import * as identityModule from '../src/client/identity.js'
import { getNameDraft, setNameDraft } from '../src/client/identity.js'

const fakeStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), _m: m }
}
const throwingStorage = () => ({
  getItem() { throw new Error('denied') },
  setItem() { throw new Error('denied') },
})

test('the browser no longer invents or stores an identity: no uid, no cookie, no owner key', () => {
  assert.deepEqual(Object.keys(identityModule).sort(), ['getNameDraft', 'setNameDraft'])
  const doc = { cookie: '' }
  globalThis.document = doc
  try {
    const s = fakeStorage()
    setNameDraft('Ann', s)
    getNameDraft(s)
    assert.equal(doc.cookie, '', 'no km_uid cookie is set any more')
    assert.deepEqual([...s._m.keys()], ['km:name'], 'no km:uid')
  } finally {
    delete globalThis.document
  }
})

test('the remembered name starts empty, is cleaned on the way in, and survives later reads', () => {
  const s = fakeStorage()
  assert.equal(getNameDraft(s), '')
  assert.equal(setNameDraft('  Ann\u0000  Lee ', s), 'Ann Lee')
  assert.equal(getNameDraft(s), 'Ann Lee')
  assert.equal(setNameDraft('x'.repeat(40), s).length, 24)
})

test('an empty or invalid name clears the draft', () => {
  const s = fakeStorage()
  setNameDraft('Ann', s)
  assert.equal(setNameDraft('   ', s), '')
  assert.equal(getNameDraft(s), '')
  setNameDraft('Ann', s)
  assert.equal(setNameDraft(undefined, s), '')
  assert.equal(getNameDraft(s), '')
})

test('works with storage that throws, keeping the value in memory', () => {
  const s = throwingStorage()
  assert.equal(getNameDraft(s), '')
  setNameDraft('Zed', s)
  assert.equal(getNameDraft(s), 'Zed')
})

test('works with no storage at all', () => {
  setNameDraft('Kit', null)
  assert.equal(getNameDraft(null), 'Kit')
  setNameDraft('', null)
})
