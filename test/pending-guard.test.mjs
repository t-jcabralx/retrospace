import test from 'node:test'
import assert from 'node:assert/strict'
import { withoutPending } from '../src/ui/pendingGuard.js'

test('a copy from the server is not applied over an item whose changes are still being saved', () => {
  const pending = new Map([['a', 2], ['b', 0]])
  const docs = [{ id: 'a', w: 180 }, { id: 'b', w: 200 }, { id: 'c', w: 220 }]
  assert.deepEqual(withoutPending(docs, pending, new Map([['a', 100]]), 200).map((d) => d.id), ['b', 'c'])
})

test('nothing pending: every copy goes through; and odd entries do not throw', () => {
  const docs = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(withoutPending(docs, new Map()), docs)
  assert.deepEqual(withoutPending([null, {}, { id: 'a' }], new Map([['a', 1]]), new Map([['a', 100]]), 200), [null, {}])
})

test('a change that has been unanswered for 30 s no longer holds the item back', () => {
  const pending = new Map([['a', 1]])
  const docs = [{ id: 'a' }]
  assert.equal(withoutPending(docs, pending, new Map([['a', 1000]]), 1000 + 29_999).length, 0)
  assert.equal(withoutPending(docs, pending, new Map([['a', 1000]]), 1000 + 30_000).length, 1)
})
