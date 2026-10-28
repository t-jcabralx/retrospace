import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { planOps, planClearVotes } from '../src/lib/plan.js'
import { createMemoryStore, createMongoStore } from '../src/lib/store.js'
import { validateOp } from '../src/lib/validate.js'
import { newCode, newUid } from '../src/lib/ids.js'

const op = (input) => {
  const r = validateOp(input)
  assert.ok(r.ok, r.error)
  return r.op
}
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const owner = { uid: newUid(), name: 'Olive', avatar: AV, isOwner: true }
const ann = { uid: newUid(), name: 'Ann', avatar: AV, isOwner: false }
const bob = { uid: newUid(), name: 'Bob', avatar: AV, isOwner: false }
const vote = (id) => op({ op: 'vote', id })
const stored = (id, extra = {}) => ({ id, kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, data: { text: id }, boardCode: 'ABCDEF', authorUid: owner.uid, authorName: 'Olive', votes: [], reactions: {}, deleted: false, updatedAt: 5, ...extra })
const itemsOf = (...list) => new Map(list.map((i) => [i.id, i]))
const OPEN = { code: 'ABCDEF', lastTs: 0, vote: { active: true, perPerson: 2 } }

describe('planOps: vote rules', () => {
  test('a vote is rejected unless voting is open, the owner included', () => {
    const items = itemsOf(stored('a'))
    for (const vote of [undefined, null, { active: false, perPerson: 3 }]) {
      for (const actor of [ann, owner]) {
        const r = planOps({ code: 'ABCDEF', lastTs: 0, vote }, items, [op({ op: 'vote', id: 'a' })], actor, 10)
        assert.deepEqual(r.applied, [])
        assert.deepEqual(r.rejected, [{ id: 'a', error: 'Voting is not open' }])
        assert.deepEqual(r.writes, [])
      }
    }
  })

  test('an open vote toggles the actor in and out', () => {
    const items = itemsOf(stored('a'))
    const on = planOps(OPEN, items, [vote('a')], ann, 10)
    assert.deepEqual(on.applied[0].votes, [ann.uid])
    const off = planOps(OPEN, itemsOf(stored('a', { votes: [ann.uid] })), [vote('a')], ann, 10)
    assert.deepEqual(off.applied[0].votes, [])
    assert.deepEqual(off.rejected, [])
  })

  test('adding stops at perPerson across all live items; "No votes left"', () => {
    const items = itemsOf(stored('a'), stored('b'), stored('c'))
    const r = planOps(OPEN, items, [vote('a'), vote('b'), vote('c')], ann, 10)
    assert.deepEqual(r.applied.map((i) => i.id), ['a', 'b'])
    assert.deepEqual(r.rejected, [{ id: 'c', error: 'No votes left' }])
  })

  test('the count includes votes already stored on items the batch does not touch', () => {
    const items = itemsOf(stored('a', { votes: [ann.uid] }), stored('b', { votes: [ann.uid] }), stored('c'))
    const r = planOps(OPEN, items, [vote('c')], ann, 10)
    assert.deepEqual(r.rejected, [{ id: 'c', error: 'No votes left' }])
    // a store that loaded only the touched items passes the actor's count in
    const lean = planOps(OPEN, itemsOf(stored('c')), [vote('c')], ann, 10, undefined, 2)
    assert.deepEqual(lean.rejected, [{ id: 'c', error: 'No votes left' }])
    const room = planOps(OPEN, itemsOf(stored('c')), [vote('c')], ann, 10, undefined, 1)
    assert.equal(room.applied.length, 1)
  })

  test('removing your own vote is always allowed and frees a slot, even in the same batch', () => {
    const items = itemsOf(stored('a', { votes: [ann.uid] }), stored('b', { votes: [ann.uid] }), stored('c'))
    const full = planOps(OPEN, items, [vote('a')], ann, 10)
    assert.deepEqual(full.applied[0].votes, [])
    const swap = planOps(OPEN, items, [vote('a'), vote('c')], ann, 10)
    assert.deepEqual(swap.applied.map((i) => [i.id, i.votes]), [['a', []], ['c', [ann.uid]]])
    assert.deepEqual(swap.rejected, [])
    const again = planOps(OPEN, items, [vote('c'), vote('a'), vote('c')], ann, 10)
    assert.deepEqual(again.rejected, [{ id: 'c', error: 'No votes left' }], 'the first vote on c is refused while both slots are used')
  })

  test('deleting an item you voted on frees the slot', () => {
    const items = itemsOf(stored('a', { votes: [ann.uid], authorUid: ann.uid }), stored('b', { votes: [ann.uid] }), stored('c'))
    const r = planOps(OPEN, items, [op({ op: 'delete', id: 'a' }), vote('c')], ann, 10)
    assert.deepEqual(r.rejected, [])
    assert.deepEqual(r.applied.map((i) => i.id), ['a', 'c'])
    // a deleted item's old votes do not count when counting from the map
    const gone = planOps(OPEN, itemsOf(stored('a', { votes: [ann.uid], deleted: true }), stored('b', { votes: [ann.uid] }), stored('c')), [vote('c')], ann, 10)
    assert.deepEqual(gone.rejected, [])
  })

  test('budgets are per actor: two people are independent and the owner counts like everyone', () => {
    const items = itemsOf(stored('a'), stored('b'), stored('c'))
    const r = planOps(OPEN, items, [vote('a'), vote('b'), vote('c')], bob, 10)
    assert.equal(r.applied.length, 2)
    const other = planOps(OPEN, itemsOf(stored('a', { votes: [bob.uid] }), stored('b', { votes: [bob.uid] }), stored('c')), [vote('a'), vote('c')], ann, 10)
    assert.deepEqual(other.rejected, [], 'bob being used up does not affect ann')
    assert.deepEqual(other.applied.map((i) => [i.id, i.votes]), [['a', [bob.uid, ann.uid]], ['c', [ann.uid]]])
    const own = planOps(OPEN, items, [vote('a'), vote('b'), vote('c')], owner, 10)
    assert.deepEqual(own.rejected, [{ id: 'c', error: 'No votes left' }])
  })

  test('perPerson defaults to 3 and is read from the board', () => {
    const items = itemsOf(stored('a'), stored('b'), stored('c'), stored('d'))
    const dflt = planOps({ code: 'ABCDEF', lastTs: 0, vote: { active: true } }, items, ['a', 'b', 'c', 'd'].map(vote), ann, 10)
    assert.equal(dflt.applied.length, 3)
    const one = planOps({ code: 'ABCDEF', lastTs: 0, vote: { active: true, perPerson: 1 } }, items, [vote('a'), vote('b')], ann, 10)
    assert.equal(one.applied.length, 1)
  })

  test('closed or locked boards still turn non-owners away first; the owner may vote on a closed board', () => {
    const items = itemsOf(stored('a'))
    const closed = planOps({ ...OPEN, status: 'closed' }, items, [vote('a')], ann, 10)
    assert.deepEqual(closed.rejected, [{ id: 'a', error: 'Board is closed' }])
    const locked = planOps({ ...OPEN, locked: true }, items, [vote('a')], ann, 10)
    assert.deepEqual(locked.rejected, [{ id: 'a', error: 'Board is locked' }])
    assert.equal(planOps({ ...OPEN, status: 'closed', locked: true }, items, [vote('a')], owner, 10).applied.length, 1)
  })

  test('frames and connectors are refused with "Can\'t vote on this", whether or not voting is open', () => {
    const items = itemsOf(stored('f', { kind: 'frame', data: { title: 'T' } }), stored('k', { kind: 'connector', data: { from: 'a', to: 'b' } }), stored('n'))
    for (const board of [OPEN, { code: 'ABCDEF', lastTs: 0 }]) {
      const r = planOps(board, items, [vote('f'), vote('k')], ann, 10)
      assert.deepEqual(r.rejected, [{ id: 'f', error: 'Can\'t vote on this' }, { id: 'k', error: 'Can\'t vote on this' }])
      assert.deepEqual(r.writes, [])
    }
    assert.equal(planOps(OPEN, items, [vote('n')], ann, 10).applied.length, 1)
  })

  test('voting on a missing or deleted item says Item not found, before anything about voting', () => {
    const items = itemsOf(stored('a', { deleted: true }))
    for (const board of [OPEN, { code: 'ABCDEF', lastTs: 0 }]) {
      const r = planOps(board, items, [vote('a'), vote('nope')], ann, 10)
      assert.deepEqual(r.rejected.map((x) => x.error), ['Item not found', 'Item not found'])
    }
  })

  test('a refused vote writes nothing and does not bump lastTs; inputs are not mutated', () => {
    const items = itemsOf(stored('a'))
    const before = JSON.stringify([...items])
    const r = planOps({ code: 'ABCDEF', lastTs: 7 }, items, [vote('a')], ann, 10)
    assert.deepEqual([r.writes, r.lastTs], [[], 7])
    assert.equal(JSON.stringify([...items]), before)
  })
})

describe('planClearVotes (pure)', () => {
  const items = [stored('a', { votes: [ann.uid, bob.uid], updatedAt: 100 }), stored('b'), stored('c', { votes: [ann.uid], updatedAt: 120 }), stored('d', { votes: [ann.uid], deleted: true })]

  test('clears only live items that have votes, with strictly increasing updatedAt above board.lastTs', () => {
    const r = planClearVotes({ lastTs: 5000 }, items, 4000)
    assert.deepEqual(r.changed.map((i) => [i.id, i.votes, i.updatedAt]), [['a', [], 5001], ['c', [], 5002]])
    assert.equal(r.lastTs, 5002)
    assert.deepEqual(items[0].votes, [ann.uid, bob.uid], 'the input is not mutated')
  })

  test('uses the clock when it is ahead of lastTs, and reports no change when nobody voted', () => {
    assert.deepEqual(planClearVotes({ lastTs: 1 }, items, 9000).changed.map((i) => i.updatedAt), [9000, 9001])
    const none = planClearVotes({ lastTs: 42 }, [stored('a'), stored('b')], 9000)
    assert.deepEqual([none.changed, none.lastTs], [[], 42])
  })
})

// ---- the same, through both stores (Mongo against a scripted collection) ----
const reset = async (code, store) => (await store.clearVotes(code)).changed

describe('memory store: clearVotes', () => {
  const setup = async () => {
    const store = createMemoryStore()
    const board = await store.createBoard({ code: newCode(), type: 'workshop', template: 'blank', title: 'T', ownerId: 'u_0123456789abcdef', vote: { active: true, perPerson: 3 } })
    const add = (id) => op({ op: 'add', item: { id, kind: 'note', x: 1, y: 1, w: 200, h: 200, data: { text: id } } })
    await store.applyOps(board.code, [add('a'), add('b'), add('c')], owner)
    await store.applyOps(board.code, [vote('a'), vote('b')], ann)
    await store.applyOps(board.code, [vote('a')], bob)
    return { store, code: board.code }
  }

  test('returns the changed docs with monotonic updatedAt, empties the votes, leaves rev and other items alone', async () => {
    const { store, code } = await setup()
    const before = await store.getBoard(code)
    const changed = await reset(code, store)
    assert.deepEqual(changed.map((i) => [i.id, i.votes]), [['b', []], ['a', []]], 'oldest change first, like every listing')
    assert.ok(changed[0].updatedAt > before.lastTs && changed[1].updatedAt > changed[0].updatedAt)
    const after = await store.getBoard(code)
    assert.equal(after.lastTs, changed[1].updatedAt)
    assert.equal(after.rev, before.rev)
    assert.ok((await store.listItems(code)).every((i) => i.votes.length === 0))
    assert.deepEqual((await store.itemsSince(code, before.lastTs)).map((i) => i.id).sort(), ['a', 'b'], 'pollers pick the reset up through /since')
    assert.deepEqual(await reset(code, store), [], 'a second reset changes nothing')
    assert.equal((await store.getBoard(code)).lastTs, changed[1].updatedAt)
  })

  test('deleted items are not touched, and a missing board returns an empty list', async () => {
    const { store, code } = await setup()
    await store.applyOps(code, [op({ op: 'delete', id: 'a' })], owner)
    assert.deepEqual((await reset(code, store)).map((i) => i.id), ['b'])
    assert.deepEqual(await reset(newCode(), store), [])
  })

  test('voting works again afterwards with a full budget', async () => {
    const { store, code } = await setup()
    await reset(code, store)
    const r = await store.applyOps(code, [vote('a'), vote('b'), vote('c')], ann)
    assert.equal(r.applied.length, 3)
  })

  test('applyOps enforces the budget across items the batch does not touch', async () => {
    const store = createMemoryStore()
    const board = await store.createBoard({ code: newCode(), type: 'workshop', template: 'blank', title: 'T', ownerId: 'u_x', vote: { active: true, perPerson: 2 } })
    const add = (id) => op({ op: 'add', item: { id, kind: 'note', x: 1, y: 1, w: 200, h: 200, data: { text: id } } })
    await store.applyOps(board.code, [add('a'), add('b'), add('c')], owner)
    await store.applyOps(board.code, [vote('a')], ann)
    await store.applyOps(board.code, [vote('b')], ann)
    const r = await store.applyOps(board.code, [vote('c')], ann)
    assert.deepEqual(r.rejected, [{ id: 'c', error: 'No votes left' }])
  })
})

// A scripted Mongo client: collections backed by arrays, supporting just what applyOps and clearVotes use.
function fakeMongoClient(seed, hooks = {}) {
  const data = { boards: [...seed.boards], items: [...seed.items], log: [] }
  const match = (doc, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k])
    if (v && typeof v === 'object' && '$gt' in v) return doc[k] > v.$gt
    if (v && typeof v === 'object' && '$ne' in v) return JSON.stringify(doc[k]) !== JSON.stringify(v.$ne)
    if (v && typeof v === 'object' && '$exists' in v) return (k in doc) === v.$exists
    if (Array.isArray(doc[k]) && !Array.isArray(v)) return doc[k].includes(v) // Mongo: an array field matches a scalar it contains
    return doc[k] === v
  })
  const cursor = (rows) => ({ sort: () => cursor(rows), toArray: async () => rows.map((r) => structuredClone(r)) })
  const col = (name) => ({
    createIndex: async () => 'ok',
    findOne: async (f) => structuredClone(data[name].find((d) => match(d, f)) ?? null),
    find: (f) => cursor(data[name].filter((d) => match(d, f))),
    // hooks.counts: scripted answers for the next countDocuments calls on items (to stage an interleaving); else the real count
    countDocuments: async (f) => (name === 'items' && hooks.counts?.length ? hooks.counts.shift() : data[name].filter((d) => match(d, f)).length),
    findOneAndUpdate: async (f, u) => {
      data.log.push([name, 'findOneAndUpdate', f, u])
      hooks.beforeGuarded?.(data, f)
      const d = data[name].find((x) => match(x, f))
      if (!d) return null
      Object.assign(d, structuredClone(u.$set))
      return structuredClone(d)
    },
    updateOne: async (f, u) => {
      data.log.push([name, 'updateOne', f, u])
      const d = data[name].find((x) => match(x, f))
      if (!d) return
      if (u.$set) Object.assign(d, structuredClone(u.$set))
      if (u.$max) for (const [k, v] of Object.entries(u.$max)) d[k] = Math.max(d[k] ?? 0, v)
    },
    bulkWrite: async (ops) => {
      data.log.push([name, 'bulkWrite', ops])
      for (const o of ops) {
        if (o.replaceOne) {
          const i = data[name].findIndex((x) => match(x, o.replaceOne.filter))
          if (i >= 0) data[name][i] = structuredClone(o.replaceOne.replacement)
          else data[name].push(structuredClone(o.replaceOne.replacement))
        } else if (o.updateOne) {
          const d = data[name].find((x) => match(x, o.updateOne.filter))
          if (d) Object.assign(d, structuredClone(o.updateOne.update.$set))
        }
      }
    },
  })
  return { data, client: { db: () => ({ collection: col }) } }
}

describe('mongo store (scripted collections): votes', () => {
  const board = { code: 'ABCDEF', lastTs: 900, updatedAt: 900, rev: 4, vote: { active: true, perPerson: 2 }, ownerId: 'u_x', status: 'open', locked: false }
  const item = (id, votes = [], extra = {}) => stored(id, { votes, updatedAt: 500, ...extra })
  const dbItem = (data, id) => data.items.find((i) => i.id === id)

  test('clearVotes rewrites only items with votes, each with a strictly higher updatedAt, and raises lastTs', async () => {
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('a', [ann.uid]), item('b'), item('c', [bob.uid, ann.uid]), item('d', [ann.uid], { deleted: true })] })
    const store = createMongoStore(client, 'fake')
    const before = Date.now()
    const { changed, skipped } = await store.clearVotes('ABCDEF')
    assert.equal(skipped, 0)
    assert.deepEqual(changed.map((i) => [i.id, i.votes]), [['a', []], ['c', []]])
    assert.ok(changed[0].updatedAt >= Math.max(901, before) && changed[1].updatedAt === changed[0].updatedAt + 1)
    assert.ok(changed.every((i) => i.updatedAt > 500))
    assert.equal(data.boards[0].lastTs, changed[1].updatedAt)
    assert.equal(data.boards[0].rev, 4, 'rev untouched')
    assert.deepEqual(dbItem(data, 'c').votes, [])
    assert.deepEqual(dbItem(data, 'd').votes, [ann.uid], 'deleted items are left alone')
    assert.deepEqual(await store.clearVotes('ABCDEF'), { changed: [], skipped: 0 })
    assert.deepEqual(await store.clearVotes('ZZZZZZ'), { changed: [], skipped: 0 })
  })

  test('clearVotes is guarded by the stamp it read: a write that lands in between is not erased; it retries on the new stamp', async () => {
    let raced = false
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('a', [ann.uid]), item('b', [bob.uid])] }, {
      beforeGuarded(d, filter) { // somebody else votes on `a` after the reset read it, and the clock of that write is far ahead
        if (raced || filter.id !== 'a') return
        raced = true
        Object.assign(dbItem(d, 'a'), { votes: [ann.uid, bob.uid], updatedAt: 90_000_000_000_000 })
      },
    })
    const store = createMongoStore(client, 'fake')
    const { changed, skipped } = await store.clearVotes('ABCDEF')
    assert.equal(skipped, 0)
    const a = changed.find((i) => i.id === 'a')
    assert.deepEqual(a.votes, [])
    assert.ok(a.updatedAt > 90_000_000_000_000, `never backwards: ${a.updatedAt}`)
    const filters = data.log.filter((l) => l[1] === 'findOneAndUpdate').map((l) => [l[2].id, l[2].updatedAt])
    assert.deepEqual(filters.slice(0, 2), [['a', 500], ['a', 90_000_000_000_000]], 'the second try pins the stamp it re-read')
    assert.ok(data.boards[0].lastTs >= a.updatedAt)
  })

  test('clearVotes gives up on an item that keeps changing (3 tries), counts it as skipped and still clears the rest', async () => {
    let n = 0
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('a', [ann.uid]), item('b', [bob.uid])] }, {
      beforeGuarded(d, filter) { if (filter.id === 'a') Object.assign(dbItem(d, 'a'), { updatedAt: 5000 + ++n }) },
    })
    const store = createMongoStore(client, 'fake')
    const { changed, skipped } = await store.clearVotes('ABCDEF')
    assert.deepEqual([changed.map((i) => i.id), skipped, n], [['b'], 1, 3])
    assert.deepEqual(dbItem(data, 'a').votes, [ann.uid], 'its vote is still there, and nothing was overwritten')
  })

  test('applyOps counts the actor\'s votes in the database, only when the batch holds a vote', async () => {
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('a', [ann.uid]), item('b', [ann.uid]), item('c')] })
    const store = createMongoStore(client, 'fake')
    const r = await store.applyOps('ABCDEF', [vote('c')], ann)
    assert.deepEqual([r.applied, r.rejected], [[], [{ id: 'c', error: 'No votes left' }]])
    const ok = await store.applyOps('ABCDEF', [vote('c')], bob)
    assert.equal(ok.applied.length, 1)
    assert.deepEqual(dbItem(data, 'c').votes, [bob.uid])
  })

  test('a race past the cap is undone after the write: this request\'s votes are taken back and refused, with higher stamps', async () => {
    // ann already holds 2 of 2 (on x and y), but a parallel request made the pre-write count read 0: both new votes pass the plan.
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('x', [ann.uid]), item('y', [ann.uid]), item('b'), item('c'), item('z', [bob.uid])] }, { counts: [0] })
    const store = createMongoStore(client, 'fake')
    const r = await store.applyOps('ABCDEF', [vote('b'), vote('c')], ann)
    assert.deepEqual(r.rejected, [{ id: 'b', error: 'No votes left' }, { id: 'c', error: 'No votes left' }])
    assert.deepEqual(r.applied.map((i) => [i.id, i.votes]), [['b', []], ['c', []]], 'the corrected docs are what gets published')
    const written = data.log.find((l) => l[0] === 'items' && l[1] === 'bulkWrite')[2].map((o) => o.replaceOne.replacement)
    for (const w of written) assert.ok(r.applied.find((i) => i.id === w.id).updatedAt > w.updatedAt, 'the take-back moves forward, so clients converge')
    assert.deepEqual(['x', 'y'].map((id) => dbItem(data, id).votes), [[ann.uid], [ann.uid]], 'earlier votes are untouched')
    assert.deepEqual(dbItem(data, 'z').votes, [bob.uid], 'so are other people\'s')
    assert.deepEqual(['b', 'c'].map((id) => dbItem(data, id).votes), [[], []])
    assert.ok(data.boards[0].lastTs >= Math.max(...r.applied.map((i) => i.updatedAt)))
  })

  test('only the votes this request ADDED are taken back; removals in the same batch stand', async () => {
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('x', [ann.uid]), item('y', [ann.uid]), item('w', [ann.uid]), item('c')] }, { counts: [0] })
    const store = createMongoStore(client, 'fake')
    const r = await store.applyOps('ABCDEF', [vote('w'), vote('c')], ann) // w: a removal, c: an add that the stale count let through
    assert.deepEqual(r.rejected, [{ id: 'c', error: 'No votes left' }])
    assert.deepEqual(dbItem(data, 'w').votes, [], 'the removal stays')
    assert.deepEqual(r.applied.map((i) => i.id).sort(), ['c', 'w'])
  })

  test('no race, no rollback: a vote within the cap is applied untouched and no extra writes happen', async () => {
    const { client, data } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('x', [ann.uid]), item('c')] })
    const store = createMongoStore(client, 'fake')
    const r = await store.applyOps('ABCDEF', [vote('c')], ann)
    assert.deepEqual([r.applied.map((i) => i.id), r.rejected], [['c'], []])
    assert.equal(data.log.filter((l) => l[1] === 'findOneAndUpdate').length, 0)
  })

  test('perPerson lowered below what someone holds: adding is refused, taking back is allowed', async () => {
    const { client, data } = fakeMongoClient({ boards: [{ ...structuredClone(board), vote: { active: true, perPerson: 1 } }], items: [item('x', [ann.uid]), item('y', [ann.uid]), item('c')] })
    const store = createMongoStore(client, 'fake')
    assert.deepEqual((await store.applyOps('ABCDEF', [vote('c')], ann)).rejected, [{ id: 'c', error: 'No votes left' }])
    const off = await store.applyOps('ABCDEF', [vote('x')], ann)
    assert.deepEqual([off.applied[0].votes, off.rejected], [[], []])
    assert.deepEqual(dbItem(data, 'y').votes, [ann.uid])
    // one removal later she is at 1 of 1 and still cannot add
    assert.equal((await store.applyOps('ABCDEF', [vote('c')], ann)).rejected[0].error, 'No votes left')
  })

  test('frames and connectors cannot be voted for', async () => {
    const { client } = fakeMongoClient({ boards: [structuredClone(board)], items: [item('f', [], { kind: 'frame', data: { title: 'T' } }), item('k', [], { kind: 'connector', data: { from: 'a', to: 'b' } })] })
    const store = createMongoStore(client, 'fake')
    const r = await store.applyOps('ABCDEF', [vote('f'), vote('k')], ann)
    assert.deepEqual(r.rejected, [{ id: 'f', error: 'Can\'t vote on this' }, { id: 'k', error: 'Can\'t vote on this' }])
  })
})

describe('memory store: the vote cap under concurrency and when lowered', () => {
  const make = async (vote) => {
    const store = createMemoryStore()
    const b = await store.createBoard({ code: newCode(), type: 'workshop', template: 'blank', title: 'T', ownerId: 'u_x', vote })
    const add = (id, kind = 'note', data = { text: id }) => op({ op: 'add', item: { id, kind, x: 1, y: 1, w: 200, h: 200, data } })
    return { store, code: b.code, add }
  }

  test('10 parallel requests from one person, each voting a different item, with perPerson 3: at most 3 votes stand', async () => {
    const { store, code, add } = await make({ active: true, perPerson: 3 })
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`)
    await store.applyOps(code, ids.map((id) => add(id)), owner)
    const results = await Promise.all(ids.map((id) => store.applyOps(code, [vote(id)], ann)))
    assert.equal(results.filter((r) => r.applied.length).length, 3)
    assert.equal(results.filter((r) => r.rejected[0]?.error === 'No votes left').length, 7)
    assert.equal((await store.listItems(code)).filter((i) => i.votes.includes(ann.uid)).length, 3)
  })

  test('perPerson lowered below existing votes: adds refused, removals allowed', async () => {
    const { store, code, add } = await make({ active: true, perPerson: 3 })
    await store.applyOps(code, [add('a'), add('b'), add('c'), add('d')], owner)
    await store.applyOps(code, [vote('a'), vote('b'), vote('c')], ann)
    await store.updateBoard(code, { vote: { active: true, perPerson: 1 } })
    assert.deepEqual((await store.applyOps(code, [vote('d')], ann)).rejected, [{ id: 'd', error: 'No votes left' }])
    assert.deepEqual((await store.applyOps(code, [vote('a')], ann)).applied[0].votes, [], 'taking back is always allowed')
    assert.equal((await store.applyOps(code, [vote('d')], ann)).rejected[0].error, 'No votes left', 'still over: 2 held, 1 allowed')
  })

  test('frames and connectors cannot be voted for; notes can', async () => {
    const { store, code, add } = await make({ active: true, perPerson: 3 })
    await store.applyOps(code, [add('f', 'frame', { title: 'T' }), add('n')], owner)
    const r = await store.applyOps(code, [vote('f'), vote('n')], ann)
    assert.deepEqual(r.rejected, [{ id: 'f', error: 'Can\'t vote on this' }])
    assert.equal(r.applied.length, 1)
  })

  test('clearVotes parity: strictly higher stamps, { changed, skipped: 0 }', async () => {
    const { store, code, add } = await make({ active: true, perPerson: 3 })
    await store.applyOps(code, [add('a'), add('b')], owner)
    const v = await store.applyOps(code, [vote('a'), vote('b')], ann)
    const { changed, skipped } = await store.clearVotes(code)
    assert.equal(skipped, 0)
    for (const c of changed) assert.ok(c.updatedAt > v.applied.find((i) => i.id === c.id).updatedAt)
    assert.deepEqual(changed.map((c) => c.votes), [[], []])
  })
})
