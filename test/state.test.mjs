import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, reducer, undo, redo, ordered } from '../src/client/state.js'

const doc = (id, extra = {}) => ({
  id, kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, data: { text: id },
  boardCode: 'ABC234', authorUid: 'KM-AAAA-BBBB-CCCC', authorName: 'Ann', votes: [], reactions: {}, deleted: false, updatedAt: 100, ...extra,
})
const snapshot = (items = []) => ({ board: { code: 'ABC234', title: 'T', lastTs: 150 }, items, people: [{ id: 'p1' }], now: 500 })
const add = (id, extra = {}) => ({ op: 'add', id, item: { id, kind: 'note', x: 5, y: 6, w: 200, h: 200, z: 0, rot: 0, data: { text: 'new' }, ...extra } })
const seq = () => { let n = 0; return () => `fresh-${++n}` }

test('initialState builds the item map and lastSeen from a snapshot', () => {
  const s = initialState(snapshot([doc('a', { updatedAt: 120 }), doc('b', { updatedAt: 90 })]))
  assert.equal(s.board.code, 'ABC234')
  assert.deepEqual(s.people, [{ id: 'p1' }])
  assert.deepEqual([...s.items.keys()].sort(), ['a', 'b'])
  assert.deepEqual([s.undo, s.redo], [[], []])
  assert.equal(s.lastSeen, 150)
})

test('initialState keeps the participants and the viewer\'s uid and persona from the snapshot', () => {
  const persona = { kind: 'custom', name: 'Ann', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 } }
  const parts = [{ uid: 'KM-AAAA-BBBB-CCCC', name: 'Ann', avatar: persona.avatar, kind: 'custom' }]
  const s = initialState({ ...snapshot(), viewer: { role: 'guest', uid: 'KM-AAAA-BBBB-CCCC', persona }, participants: parts })
  assert.deepEqual(s.viewer, { role: 'guest', uid: 'KM-AAAA-BBBB-CCCC', persona })
  assert.deepEqual(s.participants, parts)
  assert.deepEqual(initialState(snapshot()).participants, [])
})

test('initialState keeps the viewer from the snapshot and defaults to a guest', () => {
  assert.deepEqual(initialState({ ...snapshot(), viewer: { role: 'owner', userId: 'u_1' } }).viewer, { role: 'owner', userId: 'u_1' })
  assert.deepEqual(initialState(snapshot()).viewer, { role: 'guest' })
})

test('load replaces the whole state from a snapshot', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'local', ops: [{ op: 'delete', id: 'a' }] })
  s = reducer(s, { type: 'load', snapshot: snapshot([doc('z')]) })
  assert.deepEqual([...s.items.keys()], ['z'])
  assert.equal(s.undo.length, 0)
})

test('remote with an older updatedAt is ignored; newer or equal is applied', () => {
  let s = initialState(snapshot([doc('a', { x: 10, updatedAt: 200 })]))
  s = reducer(s, { type: 'remote', items: [doc('a', { x: 1, updatedAt: 150 })] })
  assert.equal(s.items.get('a').x, 10)
  s = reducer(s, { type: 'remote', items: [doc('a', { x: 2, updatedAt: 200 })] })
  assert.equal(s.items.get('a').x, 2)
  s = reducer(s, { type: 'remote', items: [doc('a', { x: 3, updatedAt: 250 })] })
  assert.equal(s.items.get('a').x, 3)
  assert.equal(s.lastSeen, 250)
})

test('remote adds unknown items and advances lastSeen to the max updatedAt', () => {
  let s = initialState(snapshot())
  s = reducer(s, { type: 'remote', items: [doc('n1', { updatedAt: 300 }), doc('n2', { updatedAt: 280 })] })
  assert.deepEqual([...s.items.keys()].sort(), ['n1', 'n2'])
  assert.equal(s.lastSeen, 300)
})

test('remote with deleted:true removes the item and a stale older doc cannot bring it back', () => {
  let s = initialState(snapshot([doc('a', { updatedAt: 100 })]))
  s = reducer(s, { type: 'remote', items: [doc('a', { deleted: true, updatedAt: 200 })] })
  assert.equal(s.items.has('a'), false)
  s = reducer(s, { type: 'remote', items: [doc('a', { updatedAt: 150 })] })
  assert.equal(s.items.has('a'), false)
  assert.equal(s.lastSeen, 200)
})

test('remote never mutates the previous state', () => {
  const s0 = initialState(snapshot([doc('a')]))
  reducer(s0, { type: 'remote', items: [doc('a', { x: 99, updatedAt: 999 })] })
  assert.equal(s0.items.get('a').x, 0)
  assert.equal(s0.lastSeen, 150)
})

test('ack replaces an optimistic copy with the server doc but does not advance lastSeen', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 50 } }] })
  assert.equal(s.items.get('a').x, 50)
  s = reducer(s, { type: 'ack', items: [doc('a', { x: 50, updatedAt: 400 })] })
  assert.equal(s.items.get('a').updatedAt, 400)
  assert.equal(s.lastSeen, 150)
})

test('local applies add / update / delete optimistically', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'local', ops: [add('n'), { op: 'update', id: 'a', patch: { x: 7, data: { text: 'edited' } } }] })
  assert.equal(s.items.get('n').data.text, 'new')
  assert.equal(s.items.get('a').x, 7)
  assert.deepEqual(s.items.get('a').data, { text: 'edited' })
  s = reducer(s, { type: 'local', ops: [{ op: 'delete', id: 'a' }] })
  assert.equal(s.items.has('a'), false)
})

test('local ignores ops on missing items and re-adds of existing ids', () => {
  let s = initialState(snapshot([doc('a')]))
  const s2 = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'ghost', patch: { x: 1 } }, { op: 'delete', id: 'ghost' }, add('a')] })
  assert.equal(s2.items.size, 1)
  assert.equal(s2.items.get('a').x, 0)
  assert.equal(s2.undo.length, 0)
})

test('local with track:false leaves the undo stack alone', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 9 } }], track: false })
  assert.equal(s.items.get('a').x, 9)
  assert.equal(s.undo.length, 0)
})

test('undo of an own add yields a delete op and removes the item', () => {
  let s = initialState(snapshot())
  s = reducer(s, { type: 'local', ops: [add('n')] })
  const r = undo(s)
  assert.deepEqual(r.ops, [{ op: 'delete', id: 'n' }])
  assert.equal(r.state.items.has('n'), false)
  assert.equal(r.state.undo.length, 0)
  assert.equal(r.state.redo.length, 1)
})

test('redo re-adds the item (under a fresh id, since the server keeps the old one as a tombstone)', () => {
  let s = initialState(snapshot())
  s = reducer(s, { type: 'local', ops: [add('n', { x: 42 })] })
  const u = undo(s, seq())
  const r = redo(u.state, seq())
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].op, 'add')
  assert.equal(r.ops[0].id, 'fresh-1')
  assert.equal(r.ops[0].item.id, 'fresh-1')
  assert.equal(r.ops[0].item.x, 42)
  assert.equal(r.ops[0].item.data.text, 'new')
  assert.equal(r.state.items.get('fresh-1').x, 42)
  assert.equal(r.state.undo.length, 1)
  assert.equal(r.state.redo.length, 0)
  // and undoing that again deletes the new id
  assert.deepEqual(undo(r.state).ops, [{ op: 'delete', id: 'fresh-1' }])
})

test('undo of an update restores the previous values (including data keys)', () => {
  let s = initialState(snapshot([doc('a', { x: 10, y: 20, data: { text: 'before', color: 'red' } })]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 99, data: { text: 'after' } } }] })
  const u = undo(s)
  assert.deepEqual(u.ops, [{ op: 'update', id: 'a', patch: { x: 10, data: { text: 'before' } } }])
  assert.equal(u.state.items.get('a').x, 10)
  assert.deepEqual(u.state.items.get('a').data, { text: 'before', color: 'red' })
  const r = redo(u.state)
  assert.deepEqual(r.ops, [{ op: 'update', id: 'a', patch: { x: 99, data: { text: 'after' } } }])
  assert.equal(r.state.items.get('a').x, 99)
})

test('undo of a delete re-adds the item with its content, under a fresh id', () => {
  let s = initialState(snapshot([doc('a', { x: 11, data: { text: 'keep me' } })]))
  s = reducer(s, { type: 'local', ops: [{ op: 'delete', id: 'a' }] })
  const u = undo(s, seq())
  assert.equal(u.ops[0].op, 'add')
  assert.equal(u.ops[0].id, 'fresh-1')
  assert.deepEqual(u.ops[0].item.data, { text: 'keep me' })
  assert.equal(u.ops[0].item.x, 11)
  for (const k of ['boardCode', 'authorUid', 'votes', 'reactions', 'deleted', 'updatedAt']) assert.equal(k in u.ops[0].item, false, k)
  assert.equal(u.state.items.has('fresh-1'), true)
})

test('re-added ids are remapped in older history so earlier undo entries still hit the live item', () => {
  let s = initialState(snapshot([doc('a', { x: 1 })]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 2 } }] }) // entry 1
  s = reducer(s, { type: 'local', ops: [{ op: 'delete', id: 'a' }] }) // entry 2
  const u1 = undo(s, seq()) // re-adds as fresh-1
  const u2 = undo(u1.state, seq()) // undoes the update on the re-added item
  assert.deepEqual(u2.ops, [{ op: 'update', id: 'fresh-1', patch: { x: 1 } }])
})

test('a new tracked local action clears redo', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 5 } }] })
  s = undo(s).state
  assert.equal(s.redo.length, 1)
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 6 } }] })
  assert.equal(s.redo.length, 0)
})

test('undo reverses a multi-op action as one step, in reverse order', () => {
  let s = initialState(snapshot([doc('a'), doc('b')]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 5 } }, { op: 'update', id: 'b', patch: { x: 6 } }] })
  const u = undo(s)
  assert.deepEqual(u.ops.map((o) => o.id), ['b', 'a'])
  assert.equal(u.state.items.get('a').x, 0)
  assert.equal(u.state.items.get('b').x, 0)
})

test('undo skips steps whose item vanished (deleted remotely) and sends nothing for them', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 5 } }] })
  s = reducer(s, { type: 'remote', items: [doc('a', { deleted: true, updatedAt: 900 })] })
  const u = undo(s)
  assert.deepEqual(u.ops, [])
  assert.equal(u.state.undo.length, 0)
})

test('undo and redo with empty stacks are no-ops; remote edits are never undone (own ops only)', () => {
  let s = initialState(snapshot([doc('a')]))
  s = reducer(s, { type: 'remote', items: [doc('a', { x: 5, updatedAt: 300 })] })
  const u = undo(s)
  assert.deepEqual(u.ops, [])
  assert.equal(u.state, s)
  assert.deepEqual(redo(s).ops, [])
})

test('ordered sorts by z then id', () => {
  const s = initialState(snapshot([doc('b', { z: 1 }), doc('c', { z: 0 }), doc('a', { z: 1 }), doc('d', { z: -5 })]))
  assert.deepEqual(ordered(s).map((i) => i.id), ['d', 'c', 'a', 'b'])
})

test('reducer returns the same state for an unknown action', () => {
  const s = initialState(snapshot())
  assert.equal(reducer(s, { type: 'nope' }), s)
})

test('re-delivering a doc the state already holds (e.g. a catch-up overlapping the stream) changes nothing', () => {
  let s = initialState(snapshot([doc('a', { x: 4, updatedAt: 300 })]))
  s = reducer(s, { type: 'remote', items: [doc('a', { x: 9, updatedAt: 400 })] })
  const again = reducer(s, { type: 'remote', items: [doc('a', { x: 9, updatedAt: 400 }), doc('a', { x: 4, updatedAt: 300 })] })
  assert.deepEqual([...again.items.entries()], [...s.items.entries()])
  assert.equal(again.lastSeen, s.lastSeen)
})

// --- board action ----------------------------------------------------------------------------------------
const settings = (extra = {}) => ({ code: 'ABC234', title: 'T', theme: { bg: '#fff' }, locked: false, status: 'open', revoked: false, recipient: null, revealAt: null, vote: { active: false, perPerson: 3 }, timer: null, updatedAt: 200, lastTs: 150, ...extra })
const viewerState = () => initialState({ board: settings(), items: [], viewer: { role: 'guest', uid: 'KM-AAAA-BBBB-CCCC', persona: { kind: 'custom', name: 'Ann', avatar: {} } }, participants: [{ uid: 'KM-AAAA-BBBB-CCCC' }] })

test('board merges the viewer-safe settings, keeps the viewer and everything else, and moves updatedAt', () => {
  const s0 = viewerState()
  const s1 = reducer(s0, { type: 'board', board: settings({ title: 'Renamed', locked: true, status: 'closed', revoked: true, vote: { active: true, perPerson: 5 }, timer: { endsAt: 9 }, recipient: { name: 'Sam' }, revealAt: '2026-11-01T00:00:00.000Z', updatedAt: 300 }) })
  assert.deepEqual([s1.board.title, s1.board.locked, s1.board.status, s1.board.revoked], ['Renamed', true, 'closed', true])
  assert.deepEqual([s1.board.vote, s1.board.timer, s1.board.recipient, s1.board.revealAt], [{ active: true, perPerson: 5 }, { endsAt: 9 }, { name: 'Sam' }, '2026-11-01T00:00:00.000Z'])
  assert.equal(s1.board.updatedAt, 300)
  assert.equal(s1.board.code, 'ABC234')
  assert.equal(s1.viewer, s0.viewer, 'the viewer is never touched')
  assert.equal(s1.items, s0.items)
  assert.equal(s1.participants, s0.participants)
  assert.equal(s0.board.title, 'T', 'the old state is not mutated')
})

test('board ignores a stale update (older updatedAt) and accepts an equal one', () => {
  const s0 = viewerState()
  assert.equal(reducer(s0, { type: 'board', board: settings({ title: 'Old', updatedAt: 199 }) }), s0)
  assert.equal(reducer(s0, { type: 'board', board: settings({ title: 'Same ms', updatedAt: 200 }) }).board.title, 'Same ms')
})

test('board never takes unsafe or foreign fields, and ignores values of the wrong shape', () => {
  const s1 = reducer(viewerState(), { type: 'board', board: settings({ updatedAt: 300, ownerId: 'u_x', createdBy: 'u_x', passcodeHash: 'h', lastTs: 99999, code: 'ZZZZZZ', type: 'hacked', title: 'Ok', locked: 'yes', status: 'weird', vote: 'no', timer: 5 }) })
  assert.equal(s1.board.title, 'Ok')
  assert.deepEqual([s1.board.locked, s1.board.status, s1.board.vote, s1.board.timer], [false, 'open', { active: false, perPerson: 3 }, null])
  for (const k of ['ownerId', 'createdBy', 'passcodeHash']) assert.ok(!(k in s1.board), k)
  assert.deepEqual([s1.board.lastTs, s1.board.code, s1.board.type], [150, 'ABC234', undefined])
})

test('board with a missing stamp, a non-object or no loaded board does nothing', () => {
  const s0 = viewerState()
  for (const bad of [null, 'x', [], {}, { title: 'x' }, { title: 'x', updatedAt: 'soon' }, { title: 'x', updatedAt: NaN }]) assert.equal(reducer(s0, { type: 'board', board: bad }), s0, JSON.stringify(bad))
  const empty = { ...s0, board: undefined }
  assert.equal(reducer(empty, { type: 'board', board: settings() }), empty)
})

test('board does not disturb a pending local edit or the undo history', () => {
  let s = viewerState()
  s = reducer(s, { type: 'load', snapshot: { ...snapshot([doc('a')]), board: settings(), viewer: s.viewer } })
  s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'a', patch: { x: 50 } }] })
  const next = reducer(s, { type: 'board', board: settings({ locked: true, updatedAt: 999 }) })
  assert.equal(next.items.get('a').x, 50)
  assert.equal(next.undo.length, 1)
})

// --- board action: ordering by rev ------------------------------------------------------------------------
const rv = (rev, extra = {}) => settings({ rev, ...extra })
const revState = (rev = 3, updatedAt = 5000) => initialState({ board: settings({ rev, updatedAt }), items: [], viewer: { role: 'guest', uid: 'KM-AAAA-BBBB-CCCC' } })

test('board: a newer rev wins even when its updatedAt is SMALLER than ours (clock skew, op-bumped stamps)', () => {
  const s1 = reducer(revState(3, 5000), { type: 'board', board: rv(4, { locked: true, updatedAt: 100 }) })
  assert.deepEqual([s1.board.locked, s1.board.rev, s1.board.updatedAt], [true, 4, 100])
})

test('board: the same rev again is a duplicate and an older rev is stale, whatever their updatedAt', () => {
  const s0 = revState(3, 5000)
  assert.equal(reducer(s0, { type: 'board', board: rv(3, { title: 'dup', updatedAt: 9999 }) }), s0)
  assert.equal(reducer(s0, { type: 'board', board: rv(2, { title: 'old', updatedAt: 9999 }) }), s0)
})

test('board: two changes in the same millisecond both apply, in rev order', () => {
  let s = revState(3, 5000)
  s = reducer(s, { type: 'board', board: rv(4, { title: 'first', updatedAt: 6000 }) })
  s = reducer(s, { type: 'board', board: rv(5, { title: 'second', locked: true, updatedAt: 6000 }) })
  assert.deepEqual([s.board.title, s.board.locked, s.board.rev], ['second', true, 5])
  assert.equal(reducer(s, { type: 'board', board: rv(4, { title: 'late first', updatedAt: 6000 }) }), s, 'arriving out of order cannot undo the newer one')
})

test('board: a board with no rev yet counts as rev 0; an incoming board without a rev falls back to updatedAt', () => {
  const legacy = viewerState() // settings() has no rev, updatedAt 200
  assert.equal(reducer(legacy, { type: 'board', board: rv(1, { title: 'first change', updatedAt: 50 }) }).board.title, 'first change')
  assert.equal(reducer(legacy, { type: 'board', board: rv(0, { title: 'zero' }) }), legacy)
  const s = revState(3, 5000)
  assert.equal(reducer(s, { type: 'board', board: settings({ title: 'older clock', updatedAt: 100 }) }), s)
  assert.equal(reducer(s, { type: 'board', board: settings({ title: 'newer clock', updatedAt: 9000 }) }).board.title, 'newer clock')
})

// ---- Task 7B ----
test('board takes hasPasscode (a boolean only) and the timer/throwables shapes', () => {
  const s0 = viewerState()
  const s1 = reducer(s0, { type: 'board', board: settings({ updatedAt: 300, hasPasscode: true, throwables: { enabled: true, emojis: ['🍌'] }, timer: { endsAt: 5, durationMs: 60000 } }) })
  assert.equal(s1.board.hasPasscode, true)
  assert.deepEqual(s1.board.throwables, { enabled: true, emojis: ['🍌'] })
  assert.deepEqual(s1.board.timer, { endsAt: 5, durationMs: 60000 })
  assert.equal(reducer(s1, { type: 'board', board: settings({ updatedAt: 301, hasPasscode: 'yes' }) }).board.hasPasscode, true, 'a non-boolean is ignored')
})

test('votes-cleared empties every item\'s votes and leaves the rest of the state alone', () => {
  const s0 = initialState({ board: settings(), items: [{ id: 'a', kind: 'note', votes: ['x', 'y'], updatedAt: 5 }, { id: 'b', kind: 'note', votes: [], updatedAt: 6 }, { id: 'c', kind: 'note', updatedAt: 7 }] })
  const s1 = reducer(s0, { type: 'votes-cleared' })
  assert.deepEqual([...s1.items.values()].map((i) => i.votes ?? null), [[], [], null])
  assert.equal(s1.items.get('b'), s0.items.get('b'), 'untouched items keep their identity')
  assert.equal(s1.items.get('a').updatedAt, 5, 'updatedAt is left for the real docs to move')
  assert.equal(s1.lastSeen, s0.lastSeen)
  assert.deepEqual(s0.items.get('a').votes, ['x', 'y'], 'the old state is not mutated')
})

test('a board message repaints the Retro stage and the anonymous-notes mode, and ignores malformed values', () => {
  const s0 = initialState(snapshot())
  const retro = { stageIndex: 1, stages: [{ key: 'collect' }] }
  const s1 = reducer(s0, { type: 'board', board: { retro, anonymousNotes: 'always', updatedAt: 300 } })
  assert.deepEqual(s1.board.retro, retro)
  assert.equal(s1.board.anonymousNotes, 'always')
  const s2 = reducer(s1, { type: 'board', board: { retro: 'x', anonymousNotes: 'sometimes', updatedAt: 400 } })
  assert.deepEqual(s2.board.retro, retro)
  assert.equal(s2.board.anonymousNotes, 'always')
})

// --- a peer's live drag --------------------------------------------------------------------------------
const dragState = () => initialState(snapshot([doc('a', { x: 10, y: 20, w: 200, h: 100 }), doc('b', { x: 0, y: 0, w: 200, h: 200 })]))
const at = (s, id) => { const i = s.items.get(id); return [i.x, i.y, i.w, i.h] }

test('a peer drag moves the item temporarily and remembers where it was', () => {
  const s = reducer(dragState(), { type: 'peer-drag', items: [{ id: 'a', x: 50, y: 60, w: 250 }], now: 1000 })
  assert.deepEqual(at(s, 'a'), [50, 60, 250, 100])
  assert.deepEqual(s.drags.get('a').base, { x: 10, y: 20, w: 200, h: 100 })
  const s2 = reducer(s, { type: 'peer-drag', items: [{ id: 'a', x: 70, y: 80 }], now: 1100 })
  assert.deepEqual(s2.drags.get('a').base, { x: 10, y: 20, w: 200, h: 100 }) // the base is the position before the FIRST step
  assert.equal(s2.undo.length, 0)
})

test('a peer drag ignores unknown or deleted items and bad numbers', () => {
  const s0 = dragState()
  assert.equal(reducer(s0, { type: 'peer-drag', items: [{ id: 'zzz', x: 1, y: 1 }] }), s0)
  assert.equal(reducer(s0, { type: 'peer-drag', items: [{ id: 'a', x: NaN, y: 1 }, { id: 'a', x: 'x', y: 1 }, null, 5] }), s0)
  assert.equal(reducer(s0, { type: 'peer-drag', items: 'no' }), s0)
  const s1 = reducer(s0, { type: 'peer-drag', items: [{ id: 'a', x: 5, y: 5, w: -10, h: 0 }] })
  assert.deepEqual(at(s1, 'a'), [5, 5, 200, 100]) // a non-positive size is not applied
})

test('a cancelled peer drag puts the item back; a dropped one keeps the position until the real write', () => {
  const moved = reducer(dragState(), { type: 'peer-drag', items: [{ id: 'a', x: 50, y: 60 }], now: 1000 })
  const back = reducer(moved, { type: 'peer-drag-end', ids: ['a'], cancel: true, now: 1200 })
  assert.deepEqual(at(back, 'a'), [10, 20, 200, 100])
  assert.equal(back.drags.size, 0)
  const dropped = reducer(moved, { type: 'peer-drag-end', ids: ['a'], now: 1200 })
  assert.deepEqual(at(dropped, 'a'), [50, 60, 200, 100])
  assert.equal(dropped.drags.get('a').ended, true)
  const real = reducer(dropped, { type: 'remote', items: [doc('a', { x: 51, y: 61, w: 200, h: 100, updatedAt: 300 })] })
  assert.deepEqual(at(real, 'a'), [51, 61, 200, 100])
  assert.equal(real.drags.size, 0)
})

test('an unfinished peer drag goes back after a while; a dropped one sooner than one still in progress', () => {
  const moved = reducer(dragState(), { type: 'peer-drag', items: [{ id: 'a', x: 50, y: 60 }, { id: 'b', x: 9, y: 9 }], now: 1000 })
  const mix = reducer(moved, { type: 'peer-drag-end', ids: ['b'], now: 1000 })
  assert.equal(reducer(mix, { type: 'peer-drag-expire', now: 3000 }), mix) // nothing is old enough yet
  const s = reducer(mix, { type: 'peer-drag-expire', now: 6000 }) // b was dropped > 4 s ago; a is still within 12 s
  assert.deepEqual(at(s, 'b'), [0, 0, 200, 200].map((v, i) => [0, 0, s.items.get('b').w, s.items.get('b').h][i]))
  assert.ok(s.drags.has('a') && !s.drags.has('b'))
  const later = reducer(s, { type: 'peer-drag-expire', now: 20000 })
  assert.deepEqual(at(later, 'a'), [10, 20, 200, 100])
})

test('a peer drag of someone else\'s named item is ignored unless the sender is the board creator', () => {
  const s0 = initialState({ ...snapshot([doc('a', { x: 10, y: 20, w: 200, h: 100, authorUid: 'KM-AUTH-0000-0000' })]), participants: [{ uid: 'KM-OWNR-0000-0000', kind: 'account' }, { uid: 'KM-OTHR-0000-0000', kind: 'custom' }] })
  assert.equal(reducer(s0, { type: 'peer-drag', items: [{ id: 'a', x: 1, y: 1 }], from: 'KM-OTHR-0000-0000' }), s0)
  assert.equal(reducer(s0, { type: 'peer-drag', items: [{ id: 'a', x: 1, y: 1 }], from: 'KM-AUTH-0000-0000' }).items.get('a').x, 1)
  assert.equal(reducer(s0, { type: 'peer-drag', items: [{ id: 'a', x: 2, y: 2 }], from: 'KM-OWNR-0000-0000' }).items.get('a').x, 2)
})

test('a peer drag step that arrives after a newer one is ignored', () => {
  const s1 = reducer(dragState(), { type: 'peer-drag', items: [{ id: 'a', x: 50, y: 60 }], q: 200, now: 1000 })
  const s2 = reducer(s1, { type: 'peer-drag', items: [{ id: 'a', x: 40, y: 40 }], q: 150, now: 1010 })
  assert.equal(s2, s1)
  assert.deepEqual(at(reducer(s1, { type: 'peer-drag', items: [{ id: 'a', x: 70, y: 80 }], q: 250, now: 1020 }), 'a').slice(0, 2), [70, 80])
})
