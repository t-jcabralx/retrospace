import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionForPresence } from '../src/lib/anon.js'
import { isVotable } from '../src/lib/vote.js'
import { planOps } from '../src/lib/plan.js'
import { validateOp } from '../src/lib/validate.js'

const map = (...items) => new Map(items.map((i) => [i.id, i]))

test('selectionForPresence: anonymous notes are filtered, others kept', () => {
  const items = map({ id: 'a', anon: true }, { id: 'b' }, { id: 'c', anon: false })
  assert.deepEqual(selectionForPresence(new Set(['a', 'b', 'c']), items), ['b', 'c'])
})

test('selectionForPresence: empty selection and unknown ids', () => {
  assert.deepEqual(selectionForPresence(new Set(), map()), [])
  assert.deepEqual(selectionForPresence(new Set(['gone']), map()), ['gone'])
  assert.deepEqual(selectionForPresence(new Set(['a']), map({ id: 'a', anon: true })), [])
})

test('actions are not votable, themes and notes are', () => {
  assert.equal(isVotable({ kind: 'action' }), false)
  assert.equal(isVotable({ kind: 'theme' }), true)
  assert.equal(isVotable({ kind: 'note' }), true)
})

test('planOps: a refused anonymous add does not move the counters of the batch', () => {
  const board = { code: 'ABC234', type: 'workshop', status: 'open', locked: false, lastTs: 0 } // mode never
  const val = (o) => { const r = validateOp(o); assert.ok(r.ok, r.error); return r.op }
  const add = (id, extra = {}) => val({ op: 'add', id, item: { id, kind: 'note', data: { text: id }, ...extra } })
  const actor = { uid: 'u1', name: 'N', avatar: null, isOwner: false }
  // 1 slot left on the board: the refused add must not eat it
  const r = planOps(board, new Map(), [add('n1', { anon: true }), add('n2')], actor, 10, 1999, 0, 0, 0, 0)
  assert.equal(r.rejected.length, 1)
  assert.equal(r.rejected[0].id, 'n1')
  assert.equal(r.applied.length, 1)
})

import { addsAnonymously } from '../src/lib/anon.js'

test('addsAnonymously: always -> notes anonymous for everyone, optional -> the toggle, never -> no; other kinds never', () => {
  assert.equal(addsAnonymously('always', false, 'note'), true)
  assert.equal(addsAnonymously('always', true, 'note'), true)
  assert.equal(addsAnonymously('optional', true, 'note'), true)
  assert.equal(addsAnonymously('optional', false, 'note'), false)
  assert.equal(addsAnonymously('never', true, 'note'), false)
  assert.equal(addsAnonymously(undefined, true, 'note'), false)
  for (const k of ['text', 'shape', 'frame']) assert.equal(addsAnonymously('always', true, k), false, k)
})
