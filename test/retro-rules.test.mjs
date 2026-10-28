import test from 'node:test'
import assert from 'node:assert/strict'
import { planOps } from '../src/lib/plan.js'
import { validateItem, validateOp, isRealDay } from '../src/lib/validate.js'
import { defaultRetro, applyRetroAction as act, STAGE_KEYS, retroAllows } from '../src/lib/retro.js'
import { checkPatch, resolvePatch } from '../src/lib/boardPatch.js'

const NOW = 5_000_000
const owner = { uid: 'owner', name: 'O', isOwner: true }
const guest = { uid: 'guest', name: 'G', isOwner: false }
const stageRetro = (key, over = {}) => ({ ...act(defaultRetro(), { type: 'goto', index: STAGE_KEYS.indexOf(key) }, NOW), ...over })
const boardAt = (key, over = {}, extra = {}) => ({ code: 'ABC123', type: 'retro', status: 'open', locked: false, lastTs: 0, vote: { active: key === 'vote', perPerson: 3 }, retro: stageRetro(key, over), ...extra })
const stored = (id, kind, authorUid, data = {}) => ({ id, kind, x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data, votes: [], reactions: {}, deleted: false, authorUid, boardCode: 'ABC123', updatedAt: 1 })
const mk = (id, kind, data) => ({ id, kind, x: 0, y: 0, w: 100, h: 100, data })
const DATA = { note: { text: 'hi' }, text: { text: 'hi' }, shape: { shape: 'rect' }, connector: { from: 'a', to: 'b' }, frame: { title: 'F' }, image: { src: 'https://x.io/a.png' }, action: { action: 'Do it' } }

function run(board, actor, op, existing = []) {
  const items = new Map(existing.map((i) => [i.id, i]))
  const o = validateOp(op)
  assert.equal(o.ok, true, JSON.stringify(o))
  const r = planOps(board, items, [o.op], actor, NOW)
  return r.rejected[0]?.error ?? 'ok'
}

const CONTENT = ['note', 'text', 'shape', 'connector', 'frame', 'image']
const MSG = { closed: 'This stage is closed for notes' }

test('content kinds: add by a participant only in Collect while editing is open (table)', () => {
  for (const key of STAGE_KEYS) for (const editing of [true, false]) for (const kind of CONTENT) {
    const want = key === 'collect' && editing ? 'ok' : MSG.closed
    const got = run(boardAt(key, { editing }), guest, { op: 'add', item: mk('n1', kind, DATA[kind]) })
    assert.equal(got, want, `${key} editing=${editing} ${kind}`)
    assert.equal(run(boardAt(key, { editing }), owner, { op: 'add', item: mk('n1', kind, DATA[kind]) }), 'ok', `owner ${key}`)
  }
})

test('content kinds: update and delete of your own item follow the same gate; other people items stay protected', () => {
  for (const key of STAGE_KEYS) for (const editing of [true, false]) {
    const mine = stored('n1', 'note', 'guest', { text: 'a' })
    const theirs = stored('n2', 'note', 'other', { text: 'a' })
    const open = key === 'collect' && editing
    assert.equal(run(boardAt(key, { editing }), guest, { op: 'update', id: 'n1', patch: { data: { text: 'b' } } }, [mine]), open ? 'ok' : MSG.closed, `update ${key} ${editing}`)
    assert.equal(run(boardAt(key, { editing }), guest, { op: 'delete', id: 'n1' }, [mine]), open ? 'ok' : MSG.closed, `delete ${key} ${editing}`)
    assert.equal(run(boardAt(key, { editing }), guest, { op: 'update', id: 'n2', patch: { x: 5 } }, [theirs]), open ? 'Not allowed' : MSG.closed)
    assert.equal(run(boardAt(key, { editing }), owner, { op: 'update', id: 'n2', patch: { x: 5 } }, [theirs]), 'ok')
  }
})

test('votes: only in the Vote stage (and the board vote must be open); reactions always', () => {
  for (const key of STAGE_KEYS) {
    const n = stored('n1', 'note', 'other', { text: 'a' })
    assert.equal(run(boardAt(key), guest, { op: 'vote', id: 'n1' }, [n]), key === 'vote' ? 'ok' : 'Voting is not open', key)
    assert.equal(run(boardAt(key), guest, { op: 'react', id: 'n1', emoji: '🎉' }, [n]), 'ok', `react ${key}`)
    if (key !== 'vote') assert.equal(run(boardAt(key), owner, { op: 'vote', id: 'n1' }, [n]), 'Voting is not open') // the shared vote setting still decides for the owner
  }
  assert.equal(run(boardAt('vote'), owner, { op: 'vote', id: 'n1' }, [stored('n1', 'note', 'o', { text: 'a' })]), 'ok')
})

test('action items: participants only in Actions, capped at maxActions live ones; the owner is exempt', () => {
  for (const key of STAGE_KEYS) {
    const got = run(boardAt(key), guest, { op: 'add', item: mk('a1', 'action', DATA.action) })
    assert.equal(got, key === 'actions' ? 'ok' : 'Actions are not open yet', key)
    assert.equal(run(boardAt(key), owner, { op: 'add', item: mk('a1', 'action', DATA.action) }), 'ok')
  }
  const b = boardAt('actions', { maxActions: 2 })
  const two = [stored('a1', 'action', 'x', { action: 'a' }), stored('a2', 'action', 'y', { action: 'b' }), { ...stored('a3', 'action', 'y', { action: 'c' }), deleted: true }]
  assert.equal(run(b, guest, { op: 'add', item: mk('a9', 'action', DATA.action) }, two), 'Action limit reached')
  assert.equal(run(b, owner, { op: 'add', item: mk('a9', 'action', DATA.action) }, two), 'ok')
  assert.equal(run(b, guest, { op: 'add', item: mk('a9', 'action', DATA.action) }, two.slice(0, 1)), 'ok')
  // within one batch: the second add hits the cap, and a delete frees a slot
  const items = new Map(two.slice(0, 1).map((i) => [i.id, i]))
  const ops = [mk('b1', 'action', DATA.action), mk('b2', 'action', DATA.action)].map((item) => validateOp({ op: 'add', item }).op)
  const r = planOps(b, items, ops, guest, NOW)
  assert.deepEqual([r.applied.length, r.rejected.map((x) => x.error)], [1, ['Action limit reached']])
  const withDel = planOps(b, new Map(two.slice(0, 2).map((i) => [i.id, { ...i, authorUid: 'guest' }])), [{ op: 'delete', id: 'a1' }, validateOp({ op: 'add', item: mk('b1', 'action', DATA.action) }).op], guest, NOW)
  assert.deepEqual(withDel.rejected, [])
  // an explicit count from the store wins over the touched items
  const viaStore = planOps(b, new Map(), [validateOp({ op: 'add', item: mk('b1', 'action', DATA.action) }).op], guest, NOW, undefined, undefined, undefined, undefined, 2)
  assert.deepEqual(viaStore.rejected.map((x) => x.error), ['Action limit reached'])
  // editing an action: only in the Actions stage
  const mine = stored('a1', 'action', 'guest', { action: 'a' })
  assert.equal(run(boardAt('discuss'), guest, { op: 'update', id: 'a1', patch: { data: { status: 'done' } } }, [mine]), 'Actions are not open yet')
  assert.equal(run(boardAt('actions'), guest, { op: 'update', id: 'a1', patch: { data: { status: 'done' } } }, [mine]), 'ok')
})

test('theme and topic items are the facilitator only', () => {
  for (const kind of ['theme', 'topic']) for (const key of STAGE_KEYS) {
    const item = stored('t1', kind, 'guest', {})
    assert.equal(retroAllows(boardAt(key), { op: 'update', id: 't1' }, item, guest).ok, false)
    assert.equal(retroAllows(boardAt(key), { op: 'update', id: 't1' }, item, owner).ok, true)
  }
})

test('boards without a workflow, and other board types, behave as before', () => {
  const old = boardAt('join')
  delete old.retro
  assert.equal(run(old, guest, { op: 'add', item: mk('n1', 'note', DATA.note) }), 'ok')
  assert.equal(run(boardAt('join', {}, { type: 'workshop' }), guest, { op: 'add', item: mk('n1', 'note', DATA.note) }), 'ok')
  assert.equal(run(boardAt('join', {}, { type: 'workshop' }), owner, { op: 'add', item: mk('a1', 'action', DATA.action) }), "A action can't be added to this board")
  assert.equal(retroAllows(null, { op: 'add' }, null, guest).ok, true)
})

test('closed and locked boards still reject first', () => {
  assert.equal(run(boardAt('collect', { editing: true }, { status: 'closed' }), guest, { op: 'add', item: mk('n1', 'note', DATA.note) }), 'Board is closed')
})

// --- action items --------------------------------------------------------------------------------------------------
const act1 = (data) => validateItem(mk('a1', 'action', data))

test('action validation: lengths, defaults, status, priority, due date', () => {
  const ok = act1({ action: '  Fix CI  ' })
  assert.deepEqual(ok.item.data, { action: 'Fix CI', owner: '', due: '', measure: '', status: 'open', priority: 'normal', notes: '' })
  assert.equal(act1({ action: 'x'.repeat(200), owner: 'o'.repeat(60), measure: 'm'.repeat(200), notes: 'n'.repeat(500), due: '2028-02-29', status: 'doing', priority: 'high' }).ok, true)
  const bad = [{}, { action: '' }, { action: '   ' }, { action: 'x'.repeat(201) }, { action: 'a', owner: 'o'.repeat(61) }, { action: 'a', measure: 'm'.repeat(201) }, { action: 'a', notes: 'n'.repeat(501) },
    { action: 'a', due: '2027-02-29' }, { action: 'a', due: '2027-13-01' }, { action: 'a', due: '2027-1-1' }, { action: 'a', due: 'tomorrow' }, { action: 'a', status: 'blocked' }, { action: 'a', priority: 'urgent' }, { action: 5 }, { action: 'a', owner: 5 }]
  for (const d of bad) assert.equal(act1(d).ok, false, JSON.stringify(d))
  assert.equal(act1({ action: 'a', due: '' }).ok, true)
  assert.equal(isRealDay('2028-02-29'), true)
  assert.equal(isRealDay('2100-02-29'), false)
  assert.equal(isRealDay('2026-04-31'), false)
})

test('action data keeps only known fields', () => {
  assert.equal('evil' in act1({ action: 'a', evil: 1 }).item.data, false)
})

// --- PATCH ---------------------------------------------------------------------------------------------------------
const retroBoard = () => ({ code: 'ABC123', type: 'retro', retro: defaultRetro(), vote: { active: false, perPerson: 3 } })
const patch = async (board, retro, now = NOW) => {
  const r = await checkPatch({ retro })
  if (r.error) return r
  return resolvePatch(board, r.value, now)
}

test('PATCH retro: strict shape, unknown keys and prototype pollution refused', async () => {
  const b = retroBoard()
  const bads = [null, [], 'next', {}, { type: 'explode' }, { type: 'next', extra: 1 }, { type: 'goto', index: 1, current: 4 }, { type: '__proto__' }, { type: 'toString' }, { type: 'constructor' },
    { type: 'config', stages: 'x', hack: 1 }, JSON.parse('{"type":"next","__proto__":{"x":1}}'), { type: 'topic', itemId: '__proto__', status: 'action' }]
  for (const v of bads) {
    const r = await patch(b, v)
    assert.equal(typeof r.error, 'string', JSON.stringify(v))
  }
  assert.equal(({}).x, undefined)
  assert.equal((await checkPatch({ retro: { type: 'next' }, other: 1 })).error, 'unknown setting')
})

test('PATCH retro: applies the action, drives the vote and timer, leaves the rest alone', async () => {
  const b = retroBoard()
  const r1 = await patch(b, { type: 'goto', index: 3 })
  assert.deepEqual([r1.value.retro.current, r1.value.vote, r1.value.timer], [3, { active: true, perPerson: 3 }, { endsAt: NOW + 120_000, durationMs: 120_000 }])
  const r2 = await patch({ ...b, retro: r1.value.retro }, { type: 'next' }, NOW + 5)
  assert.deepEqual(r2.value.vote, { active: false, perPerson: 3 })
  const t = await patch(b, { type: 'topic', itemId: 'n1', status: 'discussed' })
  assert.deepEqual(Object.keys(t.value), ['retro']) // topics touch neither vote nor timer
  assert.match((await patch(b, { type: 'prev' })).error, /first stage/)
  assert.match((await patch({ code: 'X', type: 'workshop' }, { type: 'next' })).error, /no retro workflow/)
  const old = retroBoard(); delete old.retro
  assert.match((await patch(old, { type: 'next' })).error, /no retro workflow/)
})
