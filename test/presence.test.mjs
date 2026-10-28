import test from 'node:test'
import assert from 'node:assert/strict'
import { createPresence, applyEphemeral, prune, peers, cursors, selections, rosterChanges, announceText, PRESENCE_TTL_MS, CURSOR_IDLE_MS } from '../src/ui/presence.js'

const ANN = 'KM-AAAA-AAAA-AAAA'
const BOB = 'KM-BBBB-BBBB-BBBB'
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const AV2 = { bg: 6, body: 7, eyes: 0, mouth: 1, extra: 2 }
const env = (from, cid, msg) => ({ from, cid, msg })
const hello = (from, cid, name, avatar = AV) => env(from, cid, { t: 'hello', name, avatar })
const cursor = (from, cid, x, y, name = 'Ann Otter', avatar = AV) => env(from, cid, { t: 'cursor', x, y, name, avatar })
const sel = (from, cid, ids) => env(from, cid, { t: 'sel', ids })
const run = (p, ...list) => list.reduce((acc, [e, at]) => applyEphemeral(acc, e, at), p)

test('createPresence starts empty and every query returns an empty list', () => {
  const p = createPresence()
  assert.deepEqual([peers(p), cursors(p), selections(p)], [[], [], []])
})

test('hello creates a person with the stamped name and avatar, keyed by the envelope sender', () => {
  const p = run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 1000])
  assert.deepEqual(peers(p), [{ id: ANN, name: 'Ann Otter', avatar: AV, lastSeen: 1000, tabs: 1 }])
})

test('peers are sorted by name (case-insensitive), ties by id', () => {
  const p = run(createPresence(), [hello(BOB, 'c2', 'bob Beaver'), 1], [hello(ANN, 'c1', 'Zed Zebra'), 2], [hello('KM-CCCC-CCCC-CCCC', 'c3', 'Cy Crane'), 3], [hello('KM-DDDD-DDDD-DDDD', 'c4', 'cy crane'), 4])
  assert.deepEqual(peers(p).map((x) => x.name), ['bob Beaver', 'Cy Crane', 'cy crane', 'Zed Zebra'])
  assert.deepEqual(peers(p).slice(1, 3).map((x) => x.id), ['KM-CCCC-CCCC-CCCC', 'KM-DDDD-DDDD-DDDD'])
})

test('two tabs of one person are one peer with two tabs and two cursors', () => {
  const p = run(createPresence(), [hello(ANN, 'tab1', 'Ann Otter'), 1000], [cursor(ANN, 'tab1', 10, 20), 1100], [cursor(ANN, 'tab2', 30, 40), 1200])
  assert.deepEqual(peers(p).map((x) => [x.id, x.tabs, x.lastSeen]), [[ANN, 2, 1200]])
  assert.deepEqual(cursors(p).map((c) => [c.key, c.id, c.x, c.y]), [['tab1', ANN, 10, 20], ['tab2', ANN, 30, 40]])
})

test('an envelope without a cid is keyed by the sender, and is a different tab from a cid-ed one', () => {
  const p = run(createPresence(), [cursor(ANN, undefined, 1, 2), 10], [cursor(ANN, 'c9', 3, 4), 11])
  assert.deepEqual(cursors(p).map((c) => c.key).sort(), [ANN, 'c9'].sort())
  assert.equal(peers(p)[0].tabs, 2)
})

test('a cursor message stamps the persona too, and a changed name or avatar replaces the old one', () => {
  let p = run(createPresence(), [cursor(ANN, 'c1', 5, 6, 'Ann Otter', AV), 1])
  assert.deepEqual(peers(p).map((x) => x.name), ['Ann Otter'])
  p = applyEphemeral(p, cursor(ANN, 'c1', 7, 8, 'Ann Renamed', AV2), 2)
  assert.deepEqual(peers(p).map((x) => [x.name, x.avatar]), [['Ann Renamed', AV2]])
  assert.deepEqual(cursors(p).map((c) => [c.name, c.avatar, c.x, c.y]), [['Ann Renamed', AV2, 7, 8]])
})

test('cursors report the time of the last cursor message and drop out after the idle limit when asked', () => {
  const p = run(createPresence(), [cursor(ANN, 'c1', 1, 1), 1000], [hello(ANN, 'c1', 'Ann Otter'), 9000])
  assert.equal(cursors(p)[0].lastSeen, 1000, 'a hello does not move the cursor timestamp')
  assert.equal(cursors(p, 1000 + CURSOR_IDLE_MS).length, 1)
  assert.equal(cursors(p, 1001 + CURSOR_IDLE_MS).length, 0)
  assert.equal(peers(p).length, 1, 'the person is still here')
  assert.equal(cursors(p, 1001 + CURSOR_IDLE_MS, 20000).length, 1, 'the limit is a parameter')
})

test('a person who has only said hello has no cursor', () => {
  assert.deepEqual(cursors(run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 1])), [])
})

test('selections: one entry per person with the ids of their latest selection; empty clears it', () => {
  let p = run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 1], [sel(ANN, 'c1', ['a', 'b']), 2])
  assert.deepEqual(selections(p), [{ id: ANN, name: 'Ann Otter', avatar: AV, ids: ['a', 'b'] }])
  p = applyEphemeral(p, sel(ANN, 'c1', ['c']), 3)
  assert.deepEqual(selections(p).map((s) => s.ids), [['c']])
  p = applyEphemeral(p, sel(ANN, 'c1', []), 4)
  assert.deepEqual(selections(p), [])
  assert.equal(peers(p).length, 1)
})

test('with two tabs the most recent selection wins', () => {
  const p = run(createPresence(), [hello(ANN, 't1', 'Ann Otter'), 1], [sel(ANN, 't1', ['a']), 2], [sel(ANN, 't2', ['b']), 3])
  assert.deepEqual(selections(p).map((s) => s.ids), [['b']])
})

test('a selection or cursor from someone not yet named is held back until a persona arrives', () => {
  let p = run(createPresence(), [sel(BOB, 'c2', ['x']), 1])
  assert.deepEqual([peers(p), selections(p), cursors(p)], [[], [], []])
  p = applyEphemeral(p, hello(BOB, 'c2', 'Bob Beaver', AV2), 2)
  assert.deepEqual(selections(p).map((s) => [s.name, s.ids]), [['Bob Beaver', ['x']]])
})

test('prune removes people and tabs that were not heard from within the ttl (12 s by default), keeping the rest', () => {
  assert.equal(PRESENCE_TTL_MS, 12000)
  const p = run(createPresence(), [hello(ANN, 't1', 'Ann Otter'), 1000], [cursor(ANN, 't2', 1, 1), 9000], [hello(BOB, 'c2', 'Bob Beaver'), 5000])
  const a = prune(p, 13000)
  assert.equal(a, p, 'exactly 12 s of silence is still allowed')
  const b = prune(p, 13001)
  assert.deepEqual(peers(b).map((x) => [x.id, x.tabs]), [[ANN, 1], [BOB, 1]], 'ann\'s first tab went quiet; her second and bob are fine')
  const c = prune(p, 17001)
  assert.deepEqual(peers(c).map((x) => x.id), [ANN], 'bob is gone after 12 s of silence')
  const d = prune(p, 21001)
  assert.deepEqual(peers(d), [])
  assert.deepEqual([cursors(d), selections(d)], [[], []])
})

test('prune returns the same object when nothing expired, and does not mutate its input', () => {
  const p = run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 1000])
  assert.equal(prune(p, 2000), p)
  const q = prune(p, 100000)
  assert.notEqual(q, p)
  assert.equal(peers(p).length, 1)
  assert.equal(prune(p, 13000, 20000), p, 'ttl is a parameter')
})

test('a fresh message keeps a person alive past the original deadline', () => {
  let p = run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 0])
  p = applyEphemeral(p, hello(ANN, 'c1', 'Ann Otter'), 10000)
  assert.equal(peers(prune(p, 20000)).length, 1)
  assert.equal(peers(prune(p, 22001)).length, 0)
})

test('applyEphemeral is pure: it returns a new presence and leaves the old one alone', () => {
  const p0 = createPresence()
  const p1 = applyEphemeral(p0, hello(ANN, 'c1', 'Ann Otter'), 1)
  assert.notEqual(p1, p0)
  assert.deepEqual(peers(p0), [])
  const p2 = applyEphemeral(p1, cursor(ANN, 'c1', 3, 4), 2)
  assert.deepEqual(cursors(p1), [])
  assert.equal(cursors(p2).length, 1)
})

test('hostile or malformed envelopes change nothing (the same presence comes back)', () => {
  const p = run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 1])
  const bad = [
    null, undefined, 'x', 5, [], {}, { from: ANN }, { msg: { t: 'hello' } }, { from: 5, msg: { t: 'hello', name: 'X' } }, { from: '', msg: { t: 'hello', name: 'X' } },
    { from: 'x'.repeat(100), msg: { t: 'hello', name: 'X' } }, { from: BOB, msg: null }, { from: BOB, msg: 'hello' }, { from: BOB, msg: [] }, { from: BOB, msg: {} },
    { from: BOB, msg: { t: 5 } }, { from: BOB, msg: { t: 'evil', name: 'X' } }, { from: BOB, msg: { t: '__proto__' } }, { from: BOB, msg: { t: 'celebrate', effect: 'confetti' } },
    { from: BOB, cid: 'has space', msg: hello(BOB, 'c', 'X').msg }, { from: BOB, cid: 5, msg: hello(BOB, 'c', 'X').msg }, { from: BOB, cid: 'x'.repeat(41), msg: hello(BOB, 'c', 'X').msg },
    { from: BOB, cid: 'c', msg: { t: 'hello', name: 5 } }, { from: BOB, cid: 'c', msg: { t: 'hello', name: '' } }, { from: BOB, cid: 'c', msg: { t: 'hello', name: '   ' } }, { from: BOB, cid: 'c', msg: { t: 'hello' } },
    { from: BOB, cid: 'c', msg: { t: 'cursor', x: '1', y: 2, name: 'Bob' } }, { from: BOB, cid: 'c', msg: { t: 'cursor', x: 1, y: NaN, name: 'Bob' } }, { from: BOB, cid: 'c', msg: { t: 'cursor', x: 1e7, y: 0, name: 'Bob' } },
    { from: BOB, cid: 'c', msg: { t: 'cursor', x: Infinity, y: 0, name: 'Bob' } }, { from: BOB, cid: 'c', msg: { t: 'cursor', name: 'Bob' } },
    { from: BOB, cid: 'c', msg: { t: 'sel', ids: 'a' } }, { from: BOB, cid: 'c', msg: { t: 'sel', ids: [1] } }, { from: BOB, cid: 'c', msg: { t: 'sel', ids: Array(101).fill('a') } }, { from: BOB, cid: 'c', msg: { t: 'sel', ids: ['x'.repeat(41)] } }, { from: BOB, cid: 'c', msg: { t: 'sel', ids: [''] } },
  ]
  for (const b of bad) assert.equal(applyEphemeral(p, b, 5), p, JSON.stringify(b)?.slice(0, 80))
})

test('a damaged avatar falls back to one derived from the name; an oversized or control-laden name is cleaned', () => {
  const p = run(createPresence(), [hello(ANN, 'c1', 'Ann\u0000 Otter', { bg: 99 }), 1], [hello(BOB, 'c2', `  ${'N'.repeat(100)}  `, 'nope'), 2])
  const [a, b] = peers(p)
  assert.equal(a.name, 'Ann Otter')
  assert.ok(Object.keys(a.avatar).length === 5 && Object.values(a.avatar).every(Number.isInteger))
  assert.equal(b.name.length, 40)
  const again = peers(run(createPresence(), [hello(ANN, 'c1', 'Ann Otter', { bg: 99 }), 1]))[0].avatar
  assert.deepEqual(again, a.avatar, 'the fallback is deterministic')
})

test('extra fields in a message are ignored and never reach the output; the sender is only the envelope `from`', () => {
  const e = { from: ANN, cid: 'c1', msg: { t: 'cursor', x: 1, y: 2, name: 'Ann Otter', avatar: AV, uid: BOB, from: BOB, html: '<b>x</b>', __proto__: { polluted: true } } }
  const p = applyEphemeral(createPresence(), e, 1)
  assert.deepEqual(peers(p).map((x) => x.id), [ANN])
  assert.deepEqual(Object.keys(cursors(p)[0]).sort(), ['avatar', 'id', 'key', 'lastSeen', 'name', 'x', 'y'])
  assert.equal({}.polluted, undefined)
})

test('a name like __proto__ or constructor is just a name; so is a sender id like that', () => {
  const p = run(createPresence(), [hello('__proto__', 'c', '__proto__'), 1], [hello('constructor', 'c', 'constructor'), 2])
  assert.deepEqual(peers(p).map((x) => x.id).sort(), ['__proto__', 'constructor'])
})

test('presence is bounded: at most 8 tabs per person and 200 people, the oldest go first', () => {
  let p = createPresence()
  for (let i = 0; i < 12; i++) p = applyEphemeral(p, hello(ANN, `t${i}`, 'Ann Otter'), 100 + i)
  assert.equal(peers(p)[0].tabs, 8)
  p = createPresence()
  for (let i = 0; i < 230; i++) p = applyEphemeral(p, hello(`KM-${String(i).padStart(4, '0')}-AAAA-AAAA`, 'c', `Person ${String(i).padStart(3, '0')}`), 1000 + i)
  const all = peers(p)
  assert.equal(all.length, 200)
  assert.ok(!all.some((x) => x.name === 'Person 000') && all.some((x) => x.name === 'Person 229'))
})

test('cursor and selection fields are copied: later changes to the message do not leak in', () => {
  const ids = ['a']
  const p = run(createPresence(), [hello(ANN, 'c1', 'Ann Otter'), 1], [sel(ANN, 'c1', ids), 2])
  ids.push('zzz')
  assert.deepEqual(selections(p)[0].ids, ['a'])
  const out = selections(p)[0].ids
  out.push('mutated')
  assert.deepEqual(selections(p)[0].ids, ['a'])
})

// ---- roster changes and their announcement ----
const P = (name, id = name) => ({ id, name, avatar: AV, lastSeen: 0, tabs: 1 })
test('rosterChanges lists who joined and who left by id, in name order', () => {
  assert.deepEqual(rosterChanges([P('A'), P('B')], [P('B'), P('C'), P('D')]), { joined: ['C', 'D'], left: ['A'] })
  assert.deepEqual(rosterChanges([], []), { joined: [], left: [] })
  assert.deepEqual(rosterChanges([P('A', 'x')], [P('A renamed', 'x')]), { joined: [], left: [] }, 'a rename is not a join')
})

test('announceText says it briefly and never lists more than one name', () => {
  assert.equal(announceText({ joined: ['Brave Otter'], left: [] }), 'Brave Otter joined')
  assert.equal(announceText({ joined: ['Brave Otter', 'Calm Fox'], left: [] }), 'Brave Otter and 1 other joined')
  assert.equal(announceText({ joined: ['A', 'B', 'C'], left: [] }), 'A and 2 others joined')
  assert.equal(announceText({ joined: [], left: ['Calm Fox'] }), 'Calm Fox left')
  assert.equal(announceText({ joined: [], left: ['A', 'B', 'C'] }), 'A and 2 others left')
  assert.equal(announceText({ joined: ['A'], left: ['B'] }), 'A joined, B left')
  assert.equal(announceText({ joined: [], left: [] }), null)
})
