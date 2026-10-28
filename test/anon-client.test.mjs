import test from 'node:test'
import assert from 'node:assert/strict'
import { duplicateOps } from '../src/ui/ops.js'
import { reducer, initialState } from '../src/client/state.js'

const item = (over = {}) => ({ id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 1, rot: 0, data: { text: 'a' }, deleted: false, updatedAt: 5, ...over })

test('duplicating an anonymous note keeps it anonymous; a plain note stays plain', () => {
  const { ops } = duplicateOps([item({ anon: true }), item({ id: 'n2' })], ['n1', 'n2'])
  assert.equal(ops[0].item.anon, true)
  assert.ok(!('anon' in ops[1].item))
})

test('a broadcast of an anonymous note (no mine) does not make the author lose mine; others never gain it', () => {
  const s0 = initialState({ board: { code: 'ABCDEF' }, items: [item({ anon: true, authorUid: 'anon', mine: true })], viewer: { uid: 'u' }, now: 1 })
  const s1 = reducer(s0, { type: 'remote', items: [item({ anon: true, authorUid: 'anon', updatedAt: 9, data: { text: 'b' } })] })
  const kept = [...s1.items.values()][0]
  assert.equal(kept.data.text, 'b')
  assert.equal(kept.mine, true)
  const s2 = reducer(initialState({ board: { code: 'ABCDEF' }, items: [item({ anon: true, authorUid: 'anon' })], viewer: { uid: 'v' }, now: 1 }), { type: 'remote', items: [item({ anon: true, updatedAt: 9 })] })
  assert.ok(![...s2.items.values()][0].mine)
})
