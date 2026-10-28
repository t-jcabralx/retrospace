import test from 'node:test'
import assert from 'node:assert/strict'
import { viewerItem, viewerItems, opsEnvelopes, anonModeOf, resolveAnon, ANON_KINDS } from '../src/lib/anon.js'
import { validateItem, validateOp } from '../src/lib/validate.js'
import { planOps } from '../src/lib/plan.js'
import { checkPatch, resolvePatch } from '../src/lib/boardPatch.js'
import { buildSummaryInput } from '../src/lib/ai/input.js'

const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const stored = (over = {}) => ({ id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, data: { text: 'secret idea' }, boardCode: 'ABC234', authorUid: 'uid-real-1', authorName: 'Brave Otter', authorAvatar: AV, votes: ['v1'], reactions: {}, deleted: false, updatedAt: 5, ...over })
const retro = (over = {}) => ({ code: 'ABC234', type: 'retro', status: 'open', locked: false, lastTs: 0, ...over })
const note = (id, extra = {}) => ({ op: 'add', id, item: { id, kind: 'note', data: { text: id }, ...extra } })
const val = (o) => { const r = validateOp(o); assert.ok(r.ok, r.error); return r.op }
const actor = (uid, isOwner = false) => ({ uid, name: `Name ${uid}`, avatar: AV, isOwner })

test('viewerItem: an anon item loses every author field for every viewer; only the author gets mine', () => {
  const it = stored({ anon: true })
  const forAuthor = viewerItem(it, { viewerId: 'uid-real-1', role: 'guest' })
  assert.equal(forAuthor.mine, true)
  const others = [
    viewerItem(it, { viewerId: 'someone', role: 'guest' }),
    viewerItem(it, { viewerId: 'owner-id', role: 'owner' }),
    viewerItem(it, { viewerId: null }),
    viewerItem(it),
  ]
  for (const v of [forAuthor, ...others]) {
    const raw = JSON.stringify(v)
    for (const secret of ['uid-real-1', 'Brave Otter', '"bg":1']) assert.ok(!raw.includes(secret), `${secret} leaked`)
    assert.deepEqual([v.authorUid, v.authorName, v.authorAvatar, v.anon], ['anon', 'Anonymous', null, true])
    assert.equal(v.data.text, 'secret idea')
  }
  for (const v of others) assert.ok(!('mine' in v))
  assert.equal(it.authorUid, 'uid-real-1', 'the input is not mutated')
})

test('viewerItem: a normal item is unchanged (and a stray mine is dropped); deleted anon tombstones are scrubbed too', () => {
  const it = stored()
  assert.deepEqual(viewerItem({ ...it, mine: true }, { viewerId: 'uid-real-1' }), it)
  const tomb = viewerItem(stored({ anon: true, deleted: true }), { viewerId: null })
  assert.ok(!JSON.stringify(tomb).includes('uid-real-1'))
  assert.equal(viewerItems(undefined), undefined)
  assert.deepEqual(viewerItems([it, stored({ id: 'n2', anon: true })], { viewerId: 'uid-real-1' }).map((i) => !!i.mine), [false, true])
})

test('opsEnvelopes: anon items go out without from, cid or mine; the rest keep them', () => {
  const env = { t: 'ops', from: 'uid-real-1', cid: 'tab1', ops: [stored({ anon: true }), stored({ id: 'n2' })] }
  const out = opsEnvelopes(env)
  assert.equal(out.length, 2)
  const [plain, anon] = out
  assert.deepEqual([plain.from, plain.cid, plain.ops.map((i) => i.id)], ['uid-real-1', 'tab1', ['n2']])
  assert.deepEqual([anon.from, 'cid' in anon, anon.ops.map((i) => i.id)], ['anon', false, ['n1']])
  const raw = JSON.stringify(anon)
  for (const s of ['uid-real-1', 'Brave Otter', 'tab1', 'mine']) assert.ok(!raw.includes(s), s)
  assert.equal(opsEnvelopes({ ...env, ops: [stored({ id: 'n3' })] }).length, 1)
  assert.equal(opsEnvelopes({ ...env, ops: [stored({ anon: true })] }).length, 1)
})

test('anonModeOf: optional on retro by default, never elsewhere (whatever is stored)', () => {
  assert.equal(anonModeOf(retro()), 'optional')
  assert.equal(anonModeOf(retro({ anonymousNotes: 'always' })), 'always')
  assert.equal(anonModeOf(retro({ anonymousNotes: 'bogus' })), 'optional')
  assert.equal(anonModeOf({ type: 'workshop' }), 'never')
  assert.equal(anonModeOf({ type: 'celebration', anonymousNotes: 'always' }), 'never')
})

test('validateItem: anon only true|absent and only on note|text|shape|image|card; false is normalised away', () => {
  const base = { x: 0, y: 0, w: 200, h: 200 }
  const ok = { note: { text: 'a' }, text: { text: 'a' }, shape: { shape: 'rect' }, image: { src: 'https://x.test/a.png' }, card: { message: 'hi', signer: 'me', color: 'blue' } }
  for (const kind of ANON_KINDS) {
    const r = validateItem({ id: 'a', kind, ...base, data: ok[kind], anon: true })
    assert.ok(r.ok && r.item.anon === true, `${kind}: ${r.error}`)
    assert.ok(!('anon' in validateItem({ id: 'a', kind, ...base, data: ok[kind], anon: false }).item))
    assert.ok(!('anon' in validateItem({ id: 'a', kind, ...base, data: ok[kind] }).item))
  }
  const bad = { frame: { title: 't' }, connector: { from: 'a', to: 'b' }, shoutout: { toName: 'x', message: 'm', badge: 'Teamwork' } }
  for (const [kind, data] of Object.entries(bad)) {
    assert.equal(validateItem({ id: 'a', kind, ...base, data, anon: true }).error, 'this item cannot be anonymous', kind)
    assert.ok(validateItem({ id: 'a', kind, ...base, data, anon: false }).ok, `${kind} with anon:false is just a normal item`)
  }
  for (const v of ['yes', 1, null, {}, []]) assert.equal(validateItem({ id: 'a', kind: 'note', ...base, data: { text: 'a' }, anon: v }).error, 'anon must be a boolean')
})

test('validateOp: an update patch can never carry anon (immutable once posted)', () => {
  for (const anon of [true, false, null]) assert.match(validateOp({ op: 'update', id: 'a', patch: { anon } }).error, /anon cannot be changed/)
  assert.ok(validateOp({ op: 'update', id: 'a', patch: { x: 3 } }).ok)
})

test('planOps add: optional keeps the choice; never refuses; always forces non-owners only; non-anon kinds untouched', () => {
  const run = (board, o, a) => planOps(board, new Map(), [val(o)], a, 100)
  const g = actor('g1')
  const own = actor('own', true)
  // optional
  assert.equal(run(retro(), note('a', { anon: true }), g).applied[0].anon, true)
  assert.ok(!('anon' in run(retro(), note('a'), g).applied[0]))
  // never
  assert.deepEqual(run(retro({ anonymousNotes: 'never' }), note('a', { anon: true }), g).rejected, [{ id: 'a', error: 'Anonymous notes are off on this board' }])
  assert.ok(run(retro({ anonymousNotes: 'never' }), note('a'), g).applied.length === 1)
  assert.equal(run({ code: 'X', type: 'workshop' }, note('a', { anon: true }), g).rejected.length, 1, 'other board types are never anonymous')
  // always
  const always = retro({ anonymousNotes: 'always' })
  assert.equal(run(always, note('a'), g).applied[0].anon, true, 'forced for a participant')
  assert.equal(run(always, note('a', { anon: false }), g).applied[0].anon, true, 'cannot opt out')
  assert.ok(!('anon' in run(always, note('a'), own).applied[0]), 'the owner follows their own choice')
  assert.equal(run(always, note('a', { anon: true }), own).applied[0].anon, true)
  const frame = { op: 'add', id: 'f', item: { id: 'f', kind: 'frame', data: { title: 't' } } }
  assert.ok(!('anon' in run(always, frame, g).applied[0]), 'frames are never anonymous')
  // the real author stays in the store, stamped from the actor
  assert.equal(run(always, note('a'), g).applied[0].authorUid, 'g1')
})

test('planOps update/delete: the author keeps edit rights, stays anonymous, cannot flip anon; the owner may delete; others cannot', () => {
  const board = retro()
  const items = new Map([['n1', stored({ anon: true, authorUid: 'g1' })]])
  const edit = planOps(board, items, [val({ op: 'update', id: 'n1', patch: { data: { text: 'new text' }, x: 9 } })], actor('g1'), 100)
  assert.equal(edit.applied[0].anon, true)
  assert.equal(edit.applied[0].authorUid, 'g1')
  assert.equal(edit.applied[0].data.text, 'new text')
  assert.equal(planOps(board, items, [val({ op: 'update', id: 'n1', patch: { x: 1 } })], actor('g2'), 100).rejected[0].error, 'Not allowed')
  assert.equal(planOps(board, items, [val({ op: 'delete', id: 'n1' })], actor('g2'), 100).rejected[0].error, 'Not allowed')
  assert.equal(planOps(board, items, [val({ op: 'delete', id: 'n1' })], actor('own', true), 100).applied[0].deleted, true)
  assert.equal(planOps(board, items, [val({ op: 'delete', id: 'n1' })], actor('g1'), 100).applied[0].deleted, true)
  // a mode change later does not un-anonymise an existing note
  const after = planOps(retro({ anonymousNotes: 'never' }), items, [val({ op: 'update', id: 'n1', patch: { x: 2 } })], actor('g1'), 100)
  assert.equal(after.applied[0].anon, true)
})

test('PATCH anonymousNotes: strict values, retro only for optional/always', async () => {
  for (const v of ['optional', 'always', 'never']) assert.deepEqual(await checkPatch({ anonymousNotes: v }), { value: { anonymousNotes: v } })
  for (const v of ['Always', 'yes', true, null, 1, {}, '', undefined]) assert.ok((await checkPatch({ anonymousNotes: v })).error, String(v))
  assert.deepEqual(resolvePatch(retro(), { anonymousNotes: 'always' }), { value: { anonymousNotes: 'always' } })
  assert.match(resolvePatch({ type: 'workshop' }, { anonymousNotes: 'optional' }).error, /only available on retro/)
  assert.match(resolvePatch({ type: 'celebration' }, { anonymousNotes: 'always' }).error, /only available on retro/)
  assert.deepEqual(resolvePatch({ type: 'workshop' }, { anonymousNotes: 'never' }), { value: { anonymousNotes: 'never' } })
})

test('AI summary input never carries an author, anonymous or not', () => {
  const items = [stored({ anon: true }), stored({ id: 'n2', data: { text: 'another' } })]
  const raw = JSON.stringify(buildSummaryInput(items, { kind: 'retro', boardTitle: 'Retro' }))
  for (const s of ['uid-real-1', 'Brave Otter', 'authorName']) assert.ok(!raw.includes(s), s)
  assert.ok(raw.includes('secret idea'))
})

test('resolveAnon is the one rule: item kinds outside the list never become anonymous', () => {
  assert.deepEqual(resolveAnon(retro({ anonymousNotes: 'always' }), { kind: 'connector' }, false), { anon: false })
})
