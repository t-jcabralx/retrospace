import test, { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore, createMongoStore, getStore } from '../src/lib/store.js'
import { getMongo } from '../src/lib/db.js'
import { planOps } from '../src/lib/plan.js'
import { validateOp } from '../src/lib/validate.js'
import { newCode, newUid } from '../src/lib/ids.js'

const op = (input) => {
  const r = validateOp(input)
  assert.ok(r.ok, r.error)
  return r.op
}
const add = (id, data = { text: 'hi' }, extra = {}) => op({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, data, ...extra } })
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const owner = { uid: newUid(), name: 'Olive', avatar: AV, isOwner: true }
const guest = { uid: newUid(), name: 'Gus', avatar: AV, isOwner: false }
const other = { uid: newUid(), name: 'Ona', avatar: AV, isOwner: false }
const persona = (name, kind = 'custom') => ({ kind, name, avatar: { ...AV } })

const OWNER_ID = 'u_0123456789abcdef'
const newBoard = (extra = {}) => ({ code: newCode(), type: 'workshop', template: 'blank', title: 'T', ownerId: OWNER_ID, createdBy: OWNER_ID, ...extra })

// The same behavioural suite runs against the memory store and (opt-in) the Mongo store.
function defineSuite(label, makeStore, opts = {}) {
  const fresh = async (extra) => {
    const store = await makeStore()
    const board = await store.createBoard(newBoard(extra))
    return { store, board, code: board.code }
  }

  describe(label, opts, () => {
    test('create and get a board; missing board is null', async () => {
      const { store, board, code } = await fresh()
      assert.equal(board.code, code)
      assert.equal(board.locked, false)
      assert.deepEqual([board.status, board.revoked, board.passcodeHash], ['open', false, null])
      assert.equal(board.ownerId, OWNER_ID)
      assert.ok(!('ownerKeyHash' in board))
      assert.equal(typeof board.createdAt, 'number')
      assert.equal(board.lastTs, 0)
      assert.ok(!('_id' in board))
      const got = await store.getBoard(code)
      assert.deepEqual(got, board)
      assert.equal(await store.getBoard(newCode()), null)
    })

    test('claimSummary: one holder at a time, a stale flag is free, an automatic claim fires once per closure', async () => {
      const { store, code: C } = await fresh()
      const a = await store.claimSummary(C, { now: 1000, staleMs: 60_000 })
      assert.equal(a.summaryState, 'generating')
      assert.equal(await store.claimSummary(C, { now: 1500, staleMs: 60_000 }), null, 'someone is writing')
      assert.ok(await store.claimSummary(C, { now: 1000 + 60_001, staleMs: 60_000 }), 'a stale flag no longer blocks')
      assert.equal(await store.claimSummary('NOPE22', { now: 1, staleMs: 1 }), null)
      await store.updateBoard(C, { summaryState: 'idle' })
      // automatic: needs a closed board whose closedAt matches
      assert.equal(await store.claimSummary(C, { now: 5, staleMs: 60_000, autoFor: 10 }), null, 'not closed')
      await store.updateBoard(C, { status: 'closed', closedAt: 10 })
      assert.equal(await store.claimSummary(C, { now: 5, staleMs: 60_000, autoFor: 11 }), null, 'another closure')
      assert.ok(await store.claimSummary(C, { now: 5, staleMs: 60_000, autoFor: 10 }))
      await store.updateBoard(C, { summaryState: 'idle' })
      assert.equal(await store.claimSummary(C, { now: 5, staleMs: 60_000, autoFor: 10 }), null, 'that closure already had its automatic summary')
      await store.updateBoard(C, { status: 'open', closedAt: null })
      await store.updateBoard(C, { status: 'closed', closedAt: 20 })
      assert.ok(await store.claimSummary(C, { now: 5, staleMs: 60_000, autoFor: 20 }), 'closing again is a new closure')
    })

    test('createBoard with a taken code fails', async () => {
      const { store, board } = await fresh()
      await assert.rejects(() => store.createBoard(newBoard({ code: board.code })))
    })

    test('updateBoard merges the patch, ignores code/lastTs, returns null when missing', async () => {
      const { store, code } = await fresh()
      const updated = await store.updateBoard(code, { title: 'New', locked: true, code: 'ZZZZZZ', lastTs: 99 })
      assert.equal(updated.title, 'New')
      assert.equal(updated.locked, true)
      assert.equal(updated.code, code)
      assert.equal(updated.lastTs, 0)
      assert.equal((await store.getBoard(code)).title, 'New')
      assert.equal(await store.updateBoard(newCode(), { title: 'x' }), null)
    })

    test('rev starts at 0, counts settings changes only, and cannot be set by a patch; item ops leave it alone', async () => {
      const { store, board, code } = await fresh()
      assert.equal(board.rev, 0)
      assert.equal((await store.updateBoard(code, { title: 'a' })).rev, 1)
      assert.equal((await store.updateBoard(code, { title: 'b', rev: 999 })).rev, 2, 'a patch cannot set rev')
      const guest = { uid: 'KM-AAAA-BBBB-CCCC', name: 'G', avatar: { bg: 0, body: 0, eyes: 0, mouth: 0, extra: 0 }, isOwner: false }
      const r = await store.applyOps(code, [op({ op: 'add', item: { id: 'rv1', kind: 'note', x: 1, y: 1, w: 200, h: 200, data: { text: 'x' } } })], guest)
      assert.equal(r.applied.length, 1)
      const after = await store.getBoard(code)
      assert.equal(after.rev, 2, 'op writes do not bump rev')
      assert.ok(after.updatedAt >= board.updatedAt)
      const both = await Promise.all([store.updateBoard(code, { title: 'c' }), store.updateBoard(code, { title: 'd' })])
      assert.deepEqual(both.map((b) => b.rev).sort(), [3, 4], 'two quick patches get two distinct revs')
    })

    test('updateBoard never changes the owner, and stores status, revoked and passcodeHash', async () => {
      const { store, code } = await fresh()
      const u = await store.updateBoard(code, { ownerId: 'u_attacker', status: 'closed', revoked: true, passcodeHash: 'scrypt$x' })
      assert.deepEqual([u.ownerId, u.status, u.revoked, u.passcodeHash], [OWNER_ID, 'closed', true, 'scrypt$x'])
      assert.equal((await store.updateBoard(code, { passcodeHash: null })).passcodeHash, null)
    })

    test('add sets author from the actor, ignores spoofed fields, then update merges data', async () => {
      const { store, code } = await fresh()
      const spoofed = add('n1')
      spoofed.item.authorUid = 'KM-EVIL'
      spoofed.item.votes = ['x']
      spoofed.item.deleted = true
      const r1 = await store.applyOps(code, [spoofed], guest)
      assert.deepEqual(r1.rejected, [])
      const [a] = r1.applied
      assert.equal(a.authorUid, guest.uid)
      assert.equal(a.authorName, 'Gus')
      assert.equal(a.boardCode, code)
      assert.deepEqual(a.votes, [])
      assert.deepEqual(a.reactions, {})
      assert.equal(a.deleted, false)
      assert.equal(typeof a.updatedAt, 'number')
      assert.ok(!('_id' in a))

      const r2 = await store.applyOps(code, [op({ op: 'update', id: 'n1', patch: { x: 50, data: { color: 'pink' } } })], guest)
      assert.deepEqual(r2.rejected, [])
      const [it] = await store.listItems(code)
      assert.equal(it.x, 50)
      assert.equal(it.y, 2)
      assert.deepEqual(it.data, { text: 'hi', color: 'pink' })
      assert.equal(it.authorUid, guest.uid)
      assert.ok(it.updatedAt > a.updatedAt)
      assert.ok(!('_id' in it))
    })

    test('non-owner cannot update or delete another author\'s item; owner can', async () => {
      const { store, code } = await fresh()
      await store.applyOps(code, [add('n1')], guest)
      const upd = op({ op: 'update', id: 'n1', patch: { x: 9 } })
      const del = op({ op: 'delete', id: 'n1' })

      const denied = await store.applyOps(code, [upd, del], other)
      assert.deepEqual(denied.applied, [])
      assert.equal(denied.rejected.length, 2)
      assert.ok(denied.rejected.every((r) => r.id === 'n1' && r.error === 'Not allowed'))
      assert.equal((await store.listItems(code))[0].x, 1)

      const ok = await store.applyOps(code, [upd], owner)
      assert.equal(ok.applied.length, 1)
      assert.equal((await store.listItems(code))[0].x, 9)

      const own = await store.applyOps(code, [del], guest)
      assert.equal(own.applied.length, 1)
      assert.deepEqual(await store.listItems(code), [])
    })

    test('locked board rejects every non-owner op but not the owner', async () => {
      const { store, code } = await fresh({ locked: true })
      const r = await store.applyOps(code, [add('a'), op({ op: 'vote', id: 'a' })], guest)
      assert.deepEqual(r.applied, [])
      assert.deepEqual(r.rejected, [{ id: 'a', error: 'Board is locked' }, { id: 'a', error: 'Board is locked' }])
      const ok = await store.applyOps(code, [add('a')], owner)
      assert.equal(ok.applied.length, 1)
      const still = await store.applyOps(code, [op({ op: 'react', id: 'a', emoji: '🎉' })], guest)
      assert.equal(still.rejected[0].error, 'Board is locked')
    })

    test('ops on a missing board are all rejected', async () => {
      const { store } = await fresh()
      const r = await store.applyOps(newCode(), [add('a')], owner)
      assert.deepEqual(r, { applied: [], rejected: [{ id: 'a', error: 'Board not found' }] })
    })

    test('delete leaves a tombstone: hidden from listItems, returned by itemsSince', async () => {
      const { store, code } = await fresh()
      const { applied } = await store.applyOps(code, [add('a'), add('b')], guest)
      const t0 = applied[1].updatedAt
      const del = await store.applyOps(code, [op({ op: 'delete', id: 'a' })], guest)
      assert.equal(del.applied[0].deleted, true)
      assert.ok(del.applied[0].updatedAt > t0)
      assert.deepEqual((await store.listItems(code)).map((i) => i.id), ['b'])
      const since = await store.itemsSince(code, t0)
      assert.deepEqual(since.map((i) => [i.id, i.deleted]), [['a', true]])
      assert.equal((await store.itemsSince(code, 0)).length, 2)
      assert.deepEqual(await store.itemsSince(code, del.applied[0].updatedAt), [])
    })

    test('last writer wins: two updates in one batch persist the second and updatedAt strictly increases', async () => {
      const { store, code } = await fresh()
      await store.applyOps(code, [add('a')], guest)
      const r = await store.applyOps(code, [
        op({ op: 'update', id: 'a', patch: { x: 10, y: 10 } }),
        op({ op: 'update', id: 'a', patch: { x: 20 } }),
      ], guest)
      assert.equal(r.applied.length, 2)
      assert.ok(r.applied[1].updatedAt > r.applied[0].updatedAt)
      const [it] = await store.listItems(code)
      assert.equal(it.x, 20)
      assert.equal(it.y, 10)
      assert.equal(it.updatedAt, r.applied[1].updatedAt)
    })

    test('updatedAt stays monotonic when the board clock is ahead of Date.now()', async () => {
      const ahead = Date.now() + 60_000
      const { store, code } = await fresh({ lastTs: ahead })
      const r = await store.applyOps(code, [add('a'), add('b')], guest)
      assert.deepEqual(r.applied.map((i) => i.updatedAt), [ahead + 1, ahead + 2])
      assert.equal((await store.getBoard(code)).lastTs, ahead + 2)
    })

    test('the 2,001st live item is rejected; deleting one frees a slot', async () => {
      const { store, code } = await fresh()
      const ops = Array.from({ length: 2000 }, (_, i) => add(`i${i}`))
      const r1 = await store.applyOps(code, ops, owner)
      assert.equal(r1.applied.length, 2000)
      const r2 = await store.applyOps(code, [add('extra')], owner)
      assert.deepEqual(r2.rejected, [{ id: 'extra', error: 'Board is full' }])
      await store.applyOps(code, [op({ op: 'delete', id: 'i0' })], owner)
      const r3 = await store.applyOps(code, [add('extra')], owner)
      assert.equal(r3.applied.length, 1)
      assert.equal((await store.listItems(code)).length, 2000)
    })

    test('rejects adding an existing or tombstoned id, and updating/deleting missing or deleted ids', async () => {
      const { store, code } = await fresh()
      await store.applyOps(code, [add('a')], guest)
      await store.applyOps(code, [op({ op: 'delete', id: 'a' })], guest)
      const r = await store.applyOps(code, [
        add('a'),
        op({ op: 'update', id: 'a', patch: { x: 1 } }),
        op({ op: 'delete', id: 'a' }),
        op({ op: 'update', id: 'nope', patch: { x: 1 } }),
        op({ op: 'delete', id: 'nope' }),
        op({ op: 'vote', id: 'a' }),
        op({ op: 'react', id: 'nope', emoji: '🎉' }),
      ], guest)
      assert.deepEqual(r.applied, [])
      assert.deepEqual(r.rejected.map((x) => x.error), [
        'Item already exists', 'Item not found', 'Item not found', 'Item not found', 'Item not found', 'Item not found', 'Item not found',
      ])
      const dup = await store.applyOps(code, [add('b'), add('b')], guest)
      assert.equal(dup.applied.length, 1)
      assert.equal(dup.rejected[0].error, 'Item already exists')
    })

    test('one rejected op does not stop the rest of the batch', async () => {
      const { store, code } = await fresh()
      const r = await store.applyOps(code, [op({ op: 'delete', id: 'nope' }), add('a')], guest)
      assert.equal(r.applied.length, 1)
      assert.equal(r.rejected.length, 1)
    })

    test('vote toggles the actor uid on any item, for any actor (while voting is open)', async () => {
      const { store, code } = await fresh({ vote: { active: true, perPerson: 3 } })
      await store.applyOps(code, [add('a')], guest)
      const vote = op({ op: 'vote', id: 'a' })
      let r = await store.applyOps(code, [vote], other)
      assert.deepEqual(r.applied[0].votes, [other.uid])
      r = await store.applyOps(code, [vote], guest)
      assert.deepEqual(r.applied[0].votes, [other.uid, guest.uid])
      r = await store.applyOps(code, [vote], other)
      assert.deepEqual(r.applied[0].votes, [guest.uid])
      assert.deepEqual((await store.listItems(code))[0].votes, [guest.uid])
    })

    test('react toggles the uid under the emoji and drops the key when empty', async () => {
      const { store, code } = await fresh()
      await store.applyOps(code, [add('a')], guest)
      const party = op({ op: 'react', id: 'a', emoji: '🎉' })
      let r = await store.applyOps(code, [party, op({ op: 'react', id: 'a', emoji: '🔥' })], other)
      assert.deepEqual(r.applied[1].reactions, { '🎉': [other.uid], '🔥': [other.uid] })
      r = await store.applyOps(code, [party], guest)
      assert.deepEqual(r.applied[0].reactions['🎉'], [other.uid, guest.uid])
      await store.applyOps(code, [party], other)
      r = await store.applyOps(code, [party], guest)
      assert.deepEqual(r.applied[0].reactions, { '🔥': [other.uid] })
      assert.ok(!('🎉' in (await store.listItems(code))[0].reactions))
    })

    test('update re-validates the merged item per kind and never persists an invalid one', async () => {
      const { store, code } = await fresh()
      await store.applyOps(code, [
        op({ op: 'add', item: { id: 'c', kind: 'connector', data: { from: 'a', to: 'b' } } }),
        add('n'),
      ], guest)
      const bad = [
        op({ op: 'update', id: 'c', patch: { data: { from: 5 } } }), // connector needs string ids
        op({ op: 'update', id: 'n', patch: { data: { src: 'https://x.test/a.png' } } }), // src only allowed on image
        op({ op: 'update', id: 'n', patch: { data: { text: 7 } } }), // note text must stay a string
      ]
      const r = await store.applyOps(code, bad, guest)
      assert.deepEqual(r.applied, [])
      assert.equal(r.rejected.length, 3)
      assert.ok(r.rejected.every((x) => typeof x.error === 'string' && x.error))
      const items = await store.listItems(code)
      assert.deepEqual(items.find((i) => i.id === 'c').data, { from: 'a', to: 'b' })
      assert.deepEqual(items.find((i) => i.id === 'n').data, { text: 'hi' })
    })

    test('listBoardsByOwner returns only that owner\'s boards, most recently updated first', async () => {
      const store = await makeStore()
      const me = `u_${Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16)}`
      const someoneElse = 'u_ffffffffffffffff'
      const old = { createdAt: 1000, updatedAt: 1000 }
      const first = await store.createBoard(newBoard({ ownerId: me, ...old }))
      const second = await store.createBoard(newBoard({ ownerId: me, ...old }))
      const third = await store.createBoard(newBoard({ ownerId: me, ...old }))
      const theirs = await store.createBoard(newBoard({ ownerId: someoneElse, ...old }))
      const tick = () => new Promise((r) => setTimeout(r, 3)) // distinct milliseconds keep the order deterministic
      await store.applyOps(second.code, [add('a')], guest)
      await tick()
      await store.applyOps(first.code, [add('a')], guest) // contributing to a board never makes it yours
      await tick()
      await store.applyOps(theirs.code, [add('a')], guest)
      await tick()
      await store.updateBoard(third.code, { title: 'touched' })

      const boards = await store.listBoardsByOwner(me)
      assert.deepEqual(boards.map((b) => b.code), [third.code, first.code, second.code])
      assert.ok(boards.every((b, i) => i === 0 || boards[i - 1].updatedAt >= b.updatedAt))
      assert.ok(boards.every((b) => b.ownerId === me && !('_id' in b)))
      assert.deepEqual((await store.listBoardsByOwner(someoneElse)).map((b) => b.code), [theirs.code])
      assert.deepEqual(await store.listBoardsByOwner('u_0000000000000000'), [])
    })

    test('people: save replaces the list, list returns it, boards are separate', async () => {
      const { store, code } = await fresh()
      const { code: code2 } = await fresh()
      assert.deepEqual(await store.listPeople(code), [])
      await store.savePeople(code, [
        { id: 'p1', name: 'Ana', birthday: '03-14', startDate: null },
        { id: 'p2', name: 'Bo', birthday: null, startDate: null },
      ])
      await store.savePeople(code2, [{ id: 'p1', name: 'Other', birthday: null, startDate: null }])
      const list = await store.listPeople(code)
      assert.deepEqual(list.map((p) => p.name), ['Ana', 'Bo'])
      assert.ok(list.every((p) => p.boardCode === code && !('_id' in p)))
      await store.savePeople(code, [{ id: 'p2', name: 'Bo2', birthday: null, startDate: null }])
      assert.deepEqual((await store.listPeople(code)).map((p) => p.name), ['Bo2'])
      assert.deepEqual((await store.listPeople(code2)).map((p) => p.name), ['Other'])
    })

    test('deleteBoard removes the board, its items, people and participants', async () => {
      const { store, code } = await fresh()
      await store.applyOps(code, [add('a')], guest)
      await store.savePeople(code, [{ id: 'p1', name: 'Ana', birthday: null, startDate: null }])
      await store.joinParticipant(code, guest.uid, persona('Gus G'))
      await store.deleteBoard(code)
      assert.deepEqual(await store.listParticipants(code), [])
      assert.equal(await store.getParticipant(code, guest.uid), null)
      assert.equal(await store.getBoard(code), null)
      assert.deepEqual(await store.listItems(code), [])
      assert.deepEqual(await store.itemsSince(code, 0), [])
      assert.deepEqual(await store.listPeople(code), [])
      // other tests in a shared (Mongo) database own boards under OWNER_ID too: only the deleted one must be gone
      assert.ok(!(await store.listBoardsByOwner(OWNER_ID)).some((b) => b.code === code))
    })
  })
}

defineSuite('memory store', () => createMemoryStore())

// Tests that check the exact calls made to the database with plain data run without an encryption key (the encrypted form
// is covered by seal-store.test.mjs and, against a real MongoDB, by seal-mongo.test.mjs).
const unsealed = (fn) => async (...args) => {
  const key = process.env.DATA_ENCRYPTION_KEY
  delete process.env.DATA_ENCRYPTION_KEY
  try { return await fn(...args) } finally { if (key !== undefined) process.env.DATA_ENCRYPTION_KEY = key }
}

test('memory stores are isolated from each other', async () => {
  const a = createMemoryStore()
  const b = createMemoryStore()
  const board = await a.createBoard(newBoard())
  assert.equal(await b.getBoard(board.code), null)
})

test('memory store returns copies, not internal references', async () => {
  const store = createMemoryStore()
  const board = await store.createBoard(newBoard())
  const { applied } = await store.applyOps(board.code, [add('a')], guest)
  applied[0].data.text = 'mutated'
  board.title = 'mutated'
  const [it] = await store.listItems(board.code)
  it.data.text = 'mutated too'
  assert.equal((await store.listItems(board.code))[0].data.text, 'hi')
  assert.equal((await store.getBoard(board.code)).title, 'T')
})

test('getStore returns one in-memory singleton when MONGODB_URI is unset', async () => {
  const saved = process.env.MONGODB_URI
  delete process.env.MONGODB_URI
  try {
    const s = getStore()
    assert.equal(getStore(), s)
    const board = await s.createBoard(newBoard())
    assert.equal((await getStore().getBoard(board.code)).code, board.code)
    await s.deleteBoard(board.code)
  } finally {
    if (saved !== undefined) process.env.MONGODB_URI = saved
  }
})

test('mongo store retries index creation after a failure without failing the current call', unsealed(async (t) => {
  const logged = []
  t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')))
  let created = 0
  let failNext = true
  const col = {
    createIndex: async () => {
      created++
      if (failNext) { failNext = false; throw new Error('not authorized') }
    },
    findOne: async () => null,
  }
  const store = createMongoStore({ db: () => ({ collection: () => col }) }, 'fake')

  assert.equal(await store.getBoard('ABCDEF'), null) // the read still completes
  assert.equal(created, 11)
  assert.equal(logged.length, 1)
  assert.match(logged[0], /not authorized/)

  assert.equal(await store.getBoard('ABCDEF'), null)
  assert.equal(created, 22) // retried on the next call
  await store.getBoard('ABCDEF')
  assert.equal(created, 22) // and cached once it succeeds
  assert.equal(logged.length, 1)
}))

test('mongo store retries a failed connect on the next call via a client factory', async () => {
  const col = { createIndex: async () => {}, findOne: async () => null }
  const client = { db: () => ({ collection: () => col }) }
  let calls = 0
  const store = createMongoStore(async () => {
    if (++calls === 1) throw new Error('connect failed')
    return client
  }, 'fake')
  await assert.rejects(store.getBoard('ABCDEF'), /connect failed/)
  assert.equal(await store.getBoard('ABCDEF'), null)
  assert.equal(await store.getBoard('ABCDEF'), null)
  assert.equal(calls, 3)
})

test('mongo store re-ensures indexes when the resolved client changes', unsealed(async () => {
  const made = []
  const mk = () => {
    const c = { created: 0 }
    const col = { createIndex: async () => { c.created++ }, findOne: async () => null }
    c.db = () => ({ collection: () => col })
    made.push(c)
    return c
  }
  let current = mk()
  const store = createMongoStore(() => current, 'fake')
  await store.getBoard('ABCDEF')
  await store.getBoard('ABCDEF')
  assert.equal(made[0].created, 11)
  current = mk()
  await store.getBoard('ABCDEF')
  assert.equal(made[1].created, 11)
}))

test('getMongo does not cache a failed connect', async () => {
  const saved = { uri: process.env.MONGODB_URI, cached: globalThis._kmMongo }
  process.env.MONGODB_URI = 'mongodb://fake.invalid/'
  globalThis._kmMongo = undefined
  try {
    const client = { fake: true }
    let calls = 0
    const connect = async () => { if (++calls === 1) throw new Error('connect failed'); return client }
    await assert.rejects(getMongo(connect), /connect failed/)
    assert.equal(globalThis._kmMongo, undefined)
    assert.equal(await getMongo(connect), client)
    assert.equal(await getMongo(connect), client)
    assert.equal(calls, 2)
  } finally {
    if (saved.uri === undefined) delete process.env.MONGODB_URI
    else process.env.MONGODB_URI = saved.uri
    globalThis._kmMongo = saved.cached
  }
})

describe('planOps (pure)', () => {
  const board = { code: 'ABCDEF', locked: false, lastTs: 0 }

  test('does not mutate its inputs and reports final writes once per item', () => {
    const items = new Map()
    const ops = [add('a'), op({ op: 'update', id: 'a', patch: { x: 5 } }), add('b')]
    const frozen = JSON.stringify(ops)
    const plan = planOps(board, items, ops, guest, 1000)
    assert.equal(JSON.stringify(ops), frozen)
    assert.equal(items.size, 0)
    assert.equal(board.lastTs, 0)
    assert.deepEqual(plan.applied.map((i) => [i.id, i.updatedAt]), [['a', 1000], ['a', 1001], ['b', 1002]])
    assert.equal(plan.lastTs, 1002)
    assert.deepEqual(plan.writes.map((w) => [w.item.id, w.isNew, w.item.x]), [['a', true, 5], ['b', true, 1]])
  })

  test('a closed board rejects every non-owner op, with its own message, but not the owner', () => {
    const closed = { ...board, status: 'closed' }
    const ops = [add('a'), add('b')]
    const g = planOps(closed, new Map(), ops, guest, 10)
    assert.deepEqual(g.applied, [])
    assert.deepEqual(g.rejected, [{ id: 'a', error: 'Board is closed' }, { id: 'b', error: 'Board is closed' }])
    assert.deepEqual(g.writes, [])
    assert.equal(planOps(closed, new Map(), ops, owner, 10).applied.length, 2)
    const both = planOps({ ...closed, locked: true }, new Map(), [add('a')], guest, 10)
    assert.deepEqual(both.rejected, [{ id: 'a', error: 'Board is closed' }]) // closed is the more specific reason
    assert.equal(planOps({ ...board, status: 'open' }, new Map(), [add('a')], guest, 10).applied.length, 1)
  })

  test('closed also blocks votes and reactions from non-owners', () => {
    const stored = { ...add('a').item, boardCode: 'ABCDEF', authorUid: owner.uid, authorName: 'Olive', votes: [], reactions: {}, deleted: false, updatedAt: 5 }
    const items = new Map([['a', stored]])
    const r = planOps({ ...board, status: 'closed' }, items, [op({ op: 'vote', id: 'a' }), op({ op: 'react', id: 'a', emoji: '🎉' })], guest, 10)
    assert.deepEqual(r.applied, [])
    assert.equal(r.rejected.length, 2)
  })

  test('liveCount override feeds the 2,000 cap; existing updates are not new writes', () => {
    const stored = { ...add('a').item, boardCode: 'ABCDEF', authorUid: guest.uid, authorName: 'Gus', votes: [], reactions: {}, deleted: false, updatedAt: 5 }
    const items = new Map([['a', stored]])
    const full = planOps(board, items, [add('z')], guest, 10, 2000)
    assert.deepEqual(full.rejected, [{ id: 'z', error: 'Board is full' }])
    const upd = planOps(board, items, [op({ op: 'update', id: 'a', patch: { x: 3 } })], guest, 10)
    assert.equal(upd.writes[0].isNew, false)
    assert.equal(stored.x, 1)
  })
})

// Opt-in: needs a reachable MongoDB. Never runs in the default test run.
const wantMongo = process.env.KM_TEST_MONGO === '1' && !!process.env.MONGODB_URI
let mongoClient
let mongoStore
defineSuite('mongo store', () => mongoStore, {
  skip: wantMongo ? false : 'set KM_TEST_MONGO=1 and MONGODB_URI to run the Mongo suite',
})
if (wantMongo) {
  const { MongoClient } = await import('mongodb')
  before(async () => {
    mongoClient = await new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 }).connect()
    mongoStore = createMongoStore(mongoClient, 'retrospace_test')
  })
  after(async () => {
    try { await mongoClient.db('retrospace_test').dropDatabase() } finally { await mongoClient.close() }
  })
}

test('mongo listBoardsByOwner filters by ownerId, sorts by updatedAt descending and strips _id', async () => {
  const seen = []
  const docs = [{ code: 'AAAAAA', ownerId: 'u_1', updatedAt: 9 }]
  const boards = {
    createIndex: async () => {},
    find: (filter, options) => {
      seen.push(['find', filter, options])
      return { sort: (spec) => { seen.push(['sort', spec]); return { toArray: async () => docs } } }
    },
  }
  const other = { createIndex: async () => {} }
  const client = { db: () => ({ collection: (n) => (n === 'boards' ? boards : other) }) }
  const store = createMongoStore(client, 'fake')
  assert.deepEqual(await store.listBoardsByOwner('u_1'), docs)
  assert.deepEqual(seen, [['find', { ownerId: 'u_1' }, { projection: { _id: 0 } }], ['sort', { updatedAt: -1 }]])
})

test('mongo updateBoard bumps rev atomically with $inc (never $set), and rev is never part of the $set', unsealed(async () => {
  const calls = []
  const col = {
    createIndex: async () => {},
    findOneAndUpdate: async (filter, update, options) => { calls.push([filter, update, options]); return { code: 'AAAAAA', rev: 7 } },
  }
  const store = createMongoStore({ db: () => ({ collection: () => col }) }, 'fake')
  const board = await store.updateBoard('AAAAAA', { title: 'x', rev: 99, lastTs: 5, ownerId: 'u_evil' })
  assert.equal(board.rev, 7)
  const [[filter, update, options]] = calls
  assert.deepEqual(filter, { code: 'AAAAAA' })
  assert.deepEqual(update.$inc, { rev: 1 })
  assert.ok(!('rev' in update.$set) && !('lastTs' in update.$set) && !('ownerId' in update.$set))
  assert.equal(update.$set.title, 'x')
  assert.equal(options.returnDocument, 'after')
}))

test('mongo createBoard stores rev: 0', async () => {
  const inserted = []
  const col = { createIndex: async () => {}, insertOne: async (d) => { inserted.push(d) } }
  const store = createMongoStore({ db: () => ({ collection: () => col }) }, 'fake')
  const doc = await store.createBoard({ code: 'AAAAAA', type: 'workshop', template: 'blank', title: 'T', ownerId: 'u_1', createdBy: 'u_1', rev: 50 })
  assert.equal(doc.rev, 0)
  assert.equal(inserted[0].rev, 0)
})

test('mongo claimSummary: one atomic findOneAndUpdate whose filter refuses a live claim and a second automatic claim', async () => {
  const calls = []
  const col = { createIndex: async () => {}, findOneAndUpdate: async (filter, update, options) => { calls.push([filter, update, options]); return null } }
  const store = createMongoStore({ db: () => ({ collection: () => col }) }, 'fake')
  assert.equal(await store.claimSummary('AAAAAA', { now: 100_000, staleMs: 60_000 }), null)
  await store.claimSummary('AAAAAA', { now: 100_000, staleMs: 60_000, autoFor: 55 })
  const [[manual, mUpdate, options], [auto, aUpdate]] = calls
  assert.deepEqual(manual, { code: 'AAAAAA', $or: [{ summaryState: { $ne: 'generating' } }, { summaryStartedAt: { $lte: 40_000 } }] })
  assert.deepEqual(auto, { ...manual, status: 'closed', closedAt: 55, autoSummaryFor: { $ne: 55 } })
  assert.deepEqual(mUpdate.$inc, { rev: 1 })
  assert.deepEqual([mUpdate.$set.summaryState, mUpdate.$set.summaryStartedAt, mUpdate.$set.summaryError], ['generating', 100_000, null])
  assert.ok(!('autoSummaryFor' in mUpdate.$set) && aUpdate.$set.autoSummaryFor === 55)
  assert.equal(options.returnDocument, 'after')
})
