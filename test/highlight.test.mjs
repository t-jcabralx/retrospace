import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { planOps } from '../src/lib/plan.js'
import { validateOp } from '../src/lib/validate.js'
import { defaultRetro, STAGE_KEYS } from '../src/lib/retro.js'
import { initialState, reducer, undo, redo } from '../src/client/state.js'
import { viewerItem } from '../src/lib/anon.js'
import { isHighlightable, isHighlighted } from '../src/lib/highlight.js'

const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const owner = { uid: 'owner-uid', name: 'Olive', avatar: AV, isOwner: true }
const ann = { uid: 'ann-uid', name: 'Ann', avatar: AV, isOwner: false }
const bob = { uid: 'bob-uid', name: 'Bob', avatar: AV, isOwner: false }
const hl = (id, on) => ({ op: 'highlight', id, on })
const stored = (id, extra = {}) => ({ id, kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, data: { text: id }, boardCode: 'ABCDEF', authorUid: ann.uid, authorName: 'Ann', votes: [], reactions: {}, deleted: false, updatedAt: 1, ...extra })
const itemsOf = (...list) => new Map(list.map((i) => [i.id, i]))
const BOARD = { code: 'ABCDEF', lastTs: 0 }

describe('validateOp: highlight', () => {
  test('needs an id and a true or false', () => {
    assert.deepEqual(validateOp({ op: 'highlight', id: 'a', on: true }), { ok: true, op: { op: 'highlight', id: 'a', on: true } })
    assert.deepEqual(validateOp({ op: 'highlight', id: 'a', on: false, extra: 1 }).op, { op: 'highlight', id: 'a', on: false })
    for (const bad of [{ op: 'highlight', on: true }, { op: 'highlight', id: 'a' }, { op: 'highlight', id: 'a', on: 'yes' }, { op: 'highlight', id: 'a', on: 1 }, { op: 'highlight', id: '', on: true }]) {
      assert.equal(validateOp(bad).ok, false, JSON.stringify(bad))
    }
  })
})

describe('planOps: highlight rules', () => {
  test('the owner can highlight any item, and the author their own', () => {
    const items = itemsOf(stored('a'))
    for (const actor of [owner, ann]) {
      const r = planOps(BOARD, items, [hl('a', true)], actor, 10)
      assert.equal(r.rejected.length, 0)
      assert.equal(r.applied[0].hl, true)
      assert.ok(r.applied[0].updatedAt > 1, 'the change is newer, so every client takes it')
    }
  })

  test('somebody else cannot highlight another person\'s note', () => {
    const r = planOps(BOARD, itemsOf(stored('a')), [hl('a', true)], bob, 10)
    assert.deepEqual(r.applied, [])
    assert.deepEqual(r.rejected, [{ id: 'a', error: 'Not allowed' }])
    assert.deepEqual(r.writes, [])
  })

  test('it is set, not toggled: asking twice keeps it on, and false switches it off', () => {
    const on = planOps(BOARD, itemsOf(stored('a')), [hl('a', true), hl('a', true)], owner, 10)
    assert.equal(on.writes[0].item.hl, true)
    const off = planOps(BOARD, itemsOf(stored('a', { hl: true })), [hl('a', false)], owner, 10)
    assert.equal(off.applied[0].hl, false)
  })

  test('a connector, a deleted item and a missing item cannot be highlighted', () => {
    const items = itemsOf(stored('c', { kind: 'connector', data: { from: 'a', to: 'b' } }), stored('gone', { deleted: true }))
    assert.deepEqual(planOps(BOARD, items, [hl('c', true)], owner, 10).rejected, [{ id: 'c', error: 'Can\'t highlight this' }])
    assert.deepEqual(planOps(BOARD, items, [hl('gone', true)], owner, 10).rejected, [{ id: 'gone', error: 'Item not found' }])
    assert.deepEqual(planOps(BOARD, items, [hl('nope', true)], owner, 10).rejected, [{ id: 'nope', error: 'Item not found' }])
  })

  test('a locked or closed board refuses everybody but the owner', () => {
    for (const [board, error] of [[{ ...BOARD, locked: true }, 'Board is locked'], [{ ...BOARD, status: 'closed' }, 'Board is closed']]) {
      assert.deepEqual(planOps(board, itemsOf(stored('a')), [hl('a', true)], ann, 10).rejected, [{ id: 'a', error }])
      assert.equal(planOps(board, itemsOf(stored('a')), [hl('a', true)], owner, 10).rejected.length, 0)
    }
  })

  test('on a retro board an author may highlight in any stage, though notes are closed for editing', () => {
    const board = { ...BOARD, type: 'retro', retro: { ...defaultRetro(), current: STAGE_KEYS.indexOf('discuss') } }
    const edit = planOps(board, itemsOf(stored('a')), [{ op: 'update', id: 'a', patch: { x: 5 } }], ann, 10)
    assert.equal(edit.rejected[0].error, 'This stage is closed for notes')
    const point = planOps(board, itemsOf(stored('a')), [hl('a', true)], ann, 10)
    assert.equal(point.rejected.length, 0)
    assert.equal(point.applied[0].hl, true)
  })

  test('editing a highlighted note keeps its highlight', () => {
    const r = planOps(BOARD, itemsOf(stored('a', { hl: true })), [{ op: 'update', id: 'a', patch: { data: { text: 'new words' } } }], ann, 10)
    assert.equal(r.applied[0].hl, true)
    assert.equal(r.applied[0].data.text, 'new words')
  })
})

test('an anonymous note can be highlighted without naming its author', () => {
  const r = planOps(BOARD, itemsOf(stored('a', { anon: true })), [hl('a', true)], ann, 10)
  const seen = viewerItem(r.applied[0], { viewerId: null })
  assert.equal(seen.hl, true)
  assert.equal(seen.authorName, 'Anonymous')
  assert.ok(!JSON.stringify(seen).includes('ann-uid'))
})

describe('the board in the browser', () => {
  const it = (id, extra = {}) => ({ id, kind: 'note', x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { text: id }, deleted: false, updatedAt: 1, ...extra })
  const start = () => initialState({ board: { code: 'ABC234' }, items: [it('a'), it('b', { hl: true })], people: [] })

  test('a highlight shows at once and undo and redo put it back and forth', () => {
    let s = reducer(start(), { type: 'local', ops: [hl('a', true)] })
    assert.equal(s.items.get('a').hl, true)
    s = undo(s).state
    assert.notEqual(s.items.get('a').hl, true)
    s = redo(s).state
    assert.equal(s.items.get('a').hl, true)
  })

  test('removing a highlight is undone by putting it back', () => {
    let s = reducer(start(), { type: 'local', ops: [hl('b', false)] })
    assert.equal(s.items.get('b').hl, false)
    s = undo(s).state
    assert.equal(s.items.get('b').hl, true)
  })

  test('a highlight on something missing, or without true/false, changes nothing', () => {
    const s = start()
    assert.equal(reducer(s, { type: 'local', ops: [hl('zzz', true)] }), s)
    assert.equal(reducer(s, { type: 'local', ops: [{ op: 'highlight', id: 'a' }] }), s)
  })
})

test('which items can be highlighted, and which are', () => {
  assert.equal(isHighlightable({ kind: 'note' }), true)
  assert.equal(isHighlightable({ kind: 'connector' }), false)
  assert.equal(isHighlightable({ kind: 'note', deleted: true }), false)
  assert.equal(isHighlightable(null), false)
  assert.equal(isHighlighted({ kind: 'note', hl: true }), true)
  assert.equal(isHighlighted({ kind: 'note', hl: false }), false)
  assert.equal(isHighlighted({ kind: 'note' }), false)
  assert.equal(isHighlighted({ kind: 'note', hl: true, deleted: true }), false)
})

describe('through the real routes', () => {
  test('the owner highlights a guest\'s note, another guest sees it, a third person cannot change it, and the author can take it off', async () => {
    const { call, routes } = await import('./helpers/routes.mjs')
    const { board, signUp, newGuest, newBoard } = await routes()
    const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
    const o = await signUp('hlowner')
    const code = (await newBoard(o.cookie)).data.code
    const g1 = await newGuest(code)
    const g2 = await newGuest(code)
    const post = (who, ops) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: who.cookie, body: { ops } })
    const note = { id: 'n1', kind: 'note', x: 10, y: 10, w: 200, h: 140, data: { text: 'ship it' } }
    assert.equal((await post(g1, [{ op: 'add', item: note }])).data.applied.length, 1)

    const refused = await post(g2, [hl('n1', true)])
    assert.deepEqual(refused.data.rejected, [{ id: 'n1', error: 'Not allowed' }])

    const done = await post(o, [hl('n1', true)])
    assert.equal(done.status, 200)
    assert.equal(done.data.applied[0].hl, true)

    const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: g2.cookie })
    assert.equal(snap.data.items.find((i) => i.id === 'n1').hl, true)

    const mine = await post(g1, [hl('n1', false)])
    assert.equal(mine.data.applied[0].hl, false)
  })
})

describe('the Highlights list', () => {
  const note = (id, extra = {}) => ({ id, kind: 'note', x: 0, y: 0, w: 1, h: 1, z: 0, data: { text: id }, votes: [], deleted: false, updatedAt: 1, ...extra })
  const v = (n) => Array.from({ length: n }, (_, k) => `u${k}`)

  test('highlighted first, then the most voted of the rest (at most 5, only with a vote), then the actions', async () => {
    const { highlightGroups } = await import('../src/lib/highlight.js')
    const items = [
      note('lit-low', { hl: true, votes: v(1), y: 5 }), note('lit-high', { hl: true, votes: v(4), y: 9 }), note('lit-none', { hl: true, y: 1 }),
      ...Array.from({ length: 7 }, (_, i) => note(`top${i}`, { votes: v(i + 1) })),
      note('zero'), note('gone', { hl: true, deleted: true }),
      { ...note('act', { votes: v(9), hl: true }), kind: 'action', data: { action: 'Fix the build' } },
      { ...note('line', { hl: true }), kind: 'connector' }, { ...note('box', { votes: v(8) }), kind: 'frame' },
    ]
    const g = highlightGroups(items)
    assert.deepEqual(g.highlighted.map((i) => i.id), ['lit-high', 'lit-low', 'lit-none'], 'most voted first, then top to bottom')
    assert.deepEqual(g.top.map((i) => i.id), ['top6', 'top5', 'top4', 'top3', 'top2'], 'five at most, none highlighted, none without a vote, no frame, no action')
    assert.deepEqual(g.actions.map((i) => i.id), ['act'], 'an action sits only under actions')
    assert.deepEqual(highlightGroups(null), { highlighted: [], top: [], actions: [] })
  })

  test('the print model carries it, names a theme by its title and a picture by its kind, and hides authors unless asked', async () => {
    const { buildPrintModel } = await import('../src/lib/printModel.js')
    const items = [
      note('n', { hl: true, data: { text: 'ship it' }, authorUid: 'u1', authorName: 'Ann', votes: v(2) }),
      { ...note('t', { hl: true }), kind: 'theme', data: { title: 'Flaky tests', noteIds: [] } },
      { ...note('p', { hl: true }), kind: 'image', data: { src: 'https://x.example/a.png' } },
      note('quiet'),
    ]
    const m = buildPrintModel({ title: 'Sprint 5', type: 'retro' }, items, [{ uid: 'u1', name: 'Ann' }])
    assert.deepEqual(m.highlights.highlighted.map((r) => r.text).sort(), ['Flaky tests', 'Picture', 'ship it'])
    assert.ok(m.highlights.highlighted.every((r) => !('author' in r)))
    const withNames = buildPrintModel({ title: 'Sprint 5', type: 'retro' }, items, [{ uid: 'u1', name: 'Ann' }], { authors: true, isOwner: true })
    assert.equal(withNames.highlights.highlighted.find((r) => r.id === 'n').author, 'Ann')
    assert.equal(buildPrintModel({ title: 'x', type: 'retro' }, [note('only')], []).highlights, null)
    assert.equal(buildPrintModel({ title: 'x', type: 'retro' }, [note('only')], []).empty, false, 'a board with a note is not empty')
  })

  test('the plain-text copy lists each group, with votes, on one line each', async () => {
    const { highlightsText } = await import('../src/lib/highlight.js')
    const h = { highlighted: [{ id: 'a', text: 'Pairing helped\nlots', votes: 3 }], top: [{ id: 'b', text: 'Faster deploys', votes: 1 }], actions: [{ id: 'c', text: 'Fix CI', votes: 0 }] }
    assert.equal(highlightsText('Sprint 5', h), ['Highlights - Sprint 5', '', 'Highlighted', '* Pairing helped lots (3 votes)', '', 'Most voted', '- Faster deploys (1 vote)', '', 'Action items', '[ ] Fix CI'].join('\n'))
    assert.match(highlightsText('', null), /Nothing is highlighted yet/)
    assert.equal(highlightsText('', { highlighted: [], top: [], actions: [] }).startsWith('Highlights\n'), true)
  })
})
