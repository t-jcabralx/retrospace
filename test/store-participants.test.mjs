import test, { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore, createMongoStore } from '../src/lib/store.js'
import { validateOp } from '../src/lib/validate.js'
import { newCode, newUid } from '../src/lib/ids.js'
import { generatePersona } from '../src/lib/persona.js'

// Participant personas in both stores (the memory store, and the Mongo store when opted in) and the Mongo store's
// participant queries against a scripted collection. Split from store.test.mjs, which covers boards and items.
const op = (input) => {
  const r = validateOp(input)
  assert.ok(r.ok, r.error)
  return r.op
}
const add = (id, data = { text: 'hi' }, extra = {}) => op({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, data, ...extra } })
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const guest = { uid: newUid(), name: 'Gus', avatar: AV, isOwner: false }
const other = { uid: newUid(), name: 'Ona', avatar: AV, isOwner: false }
const persona = (name, kind = 'custom') => ({ kind, name, avatar: { ...AV } })

const OWNER_ID = 'u_0123456789abcdef'
const newBoard = (extra = {}) => ({ code: newCode(), type: 'workshop', template: 'blank', title: 'T', ownerId: OWNER_ID, createdBy: OWNER_ID, ...extra })

function defineSuite(label, makeStore, opts = {}) {
  const fresh = async (extra) => {
    const store = await makeStore()
    const board = await store.createBoard(newBoard(extra))
    return { store, board, code: board.code }
  }

  describe(label, opts, () => {
    test('participants: join stores the record, get and list return clean copies', async () => {
      const { store, code } = await fresh()
      assert.equal(await store.getParticipant(code, guest.uid), null)
      assert.deepEqual(await store.listParticipants(code), [])
      const rec = await store.joinParticipant(code, guest.uid, persona('Gus G'))
      assert.deepEqual(Object.keys(rec).sort(), ['avatar', 'boardCode', 'joinedAt', 'kind', 'name', 'nameLower', 'uid', 'updatedAt'])
      assert.deepEqual([rec.boardCode, rec.uid, rec.kind, rec.name, rec.nameLower, rec.avatar], [code, guest.uid, 'custom', 'Gus G', 'gus g', AV])
      assert.equal(typeof rec.joinedAt, 'number')
      assert.deepEqual(await store.getParticipant(code, guest.uid), rec)
      await store.joinParticipant(code, other.uid, persona('Ona O'))
      assert.deepEqual((await store.listParticipants(code)).map((p) => p.name), ['Gus G', 'Ona O'])
      rec.name = 'mutated'
      assert.equal((await store.getParticipant(code, guest.uid)).name, 'Gus G')
      assert.equal(await store.getParticipant(code, newUid()), null)
    })

    test('joinParticipant is insert-if-absent: a second call for the same uid returns the first record untouched', async () => {
      const { store, code } = await fresh()
      const first = await store.joinParticipant(code, guest.uid, persona('First'))
      const again = await store.joinParticipant(code, guest.uid, persona('Second'))
      assert.deepEqual(again, first)
      assert.equal((await store.listParticipants(code)).length, 1)
    })

    test('20 concurrent joinParticipant calls for one uid leave exactly one record, all returning it', async () => {
      const { store, code } = await fresh()
      const got = await Promise.all(Array.from({ length: 20 }, (_, i) => store.joinParticipant(code, guest.uid, persona(`Name ${i}`))))
      assert.equal(new Set(got.map((g) => g.name)).size, 1)
      const list = await store.listParticipants(code)
      assert.equal(list.length, 1)
      assert.equal(list[0].name, got[0].name)
    })

    test('50 concurrent joins with distinct uids all end with distinct names', async () => {
      const { store, code } = await fresh()
      const join = async (uid) => {
        for (;;) {
          const taken = new Set((await store.listParticipants(code)).map((p) => p.name))
          const p = generatePersona(Math.random, taken)
          try { return await store.joinParticipant(code, uid, p) } catch (e) { if (e.code !== 11000) throw e }
        }
      }
      const got = await Promise.all(Array.from({ length: 50 }, () => join(newUid())))
      assert.equal(new Set(got.map((g) => g.nameLower)).size, 50)
      assert.equal((await store.listParticipants(code)).length, 50)
    })

    test('two participants cannot share a name (any case): the loser gets error code 11000 and no record', async () => {
      const { store, code } = await fresh()
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => store.joinParticipant(code, newUid(), persona(i % 2 ? 'Same Name' : 'SAME name'))))
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.code, 11000)
      assert.equal((await store.listParticipants(code)).length, 1)
      const { code: code2 } = await fresh()
      await store.joinParticipant(code2, newUid(), persona('Same Name')) // another board: fine
    })

    test('the owner\'s account persona holds its name like any other: no second participant can take it, one row per owner', async () => {
      const { store, code } = await fresh()
      await store.joinParticipant(code, newUid(), persona('Olive', 'account'))
      await assert.rejects(() => store.joinParticipant(code, newUid(), persona('olive')), (e) => e.code === 11000)
      await assert.rejects(() => store.joinParticipant(code, newUid(), persona('Olive', 'account')), (e) => e.code === 11000)
      assert.equal((await store.listParticipants(code)).length, 1)
    })

    test('names that fold to the same key (look-alikes, invisible marks) are one name', async () => {
      const { store, code } = await fresh()
      await store.joinParticipant(code, newUid(), persona('Jason'))
      await assert.rejects(() => store.joinParticipant(code, newUid(), persona('J\u0430son')), (e) => e.code === 11000)
      await assert.rejects(() => store.joinParticipant(code, newUid(), persona('Jason\u034f')), (e) => e.code === 11000)
    })

    test('updateParticipant changes the persona, keeps joinedAt, enforces unique names and returns null for a stranger', async () => {
      const { store, code } = await fresh()
      const a = await store.joinParticipant(code, guest.uid, persona('Gus G'))
      await store.joinParticipant(code, other.uid, persona('Ona O'))
      const upd = await store.updateParticipant(code, guest.uid, { kind: 'custom', name: 'Gus Two', avatar: { ...AV, bg: 9 } })
      assert.deepEqual([upd.name, upd.nameLower, upd.avatar.bg, upd.joinedAt], ['Gus Two', 'gus two', 9, a.joinedAt])
      assert.deepEqual(await store.getParticipant(code, guest.uid), upd)
      await assert.rejects(() => store.updateParticipant(code, guest.uid, persona('ona o')), (e) => e.code === 11000)
      assert.equal((await store.getParticipant(code, guest.uid)).name, 'Gus Two')
      assert.equal((await store.updateParticipant(code, guest.uid, persona('GUS TWO'))).name, 'GUS TWO') // my own name again is fine
      assert.equal(await store.updateParticipant(code, newUid(), persona('Nobody')), null)
    })

    test('updateParticipant is refused once the participant has authored an item, unless the lock is switched off (owner)', async () => {
      const { store, code } = await fresh()
      await store.joinParticipant(code, guest.uid, persona('Gus G'))
      await store.joinParticipant(code, other.uid, persona('Ona O'))
      assert.equal(await store.countAuthoredItems(code, guest.uid), 0)
      await store.updateParticipant(code, guest.uid, persona('Gus H')) // still free
      await store.applyOps(code, [add('a')], guest)
      assert.equal(await store.countAuthoredItems(code, guest.uid), 1)
      assert.equal(await store.countAuthoredItems(code, other.uid), 0)
      await assert.rejects(() => store.updateParticipant(code, guest.uid, persona('Gus I')), (e) => e.code === 'PERSONA_LOCKED')
      assert.equal((await store.getParticipant(code, guest.uid)).name, 'Gus H')
      await store.updateParticipant(code, other.uid, persona('Ona P')) // someone else is unaffected
      assert.equal((await store.updateParticipant(code, guest.uid, persona('Gus J'), { lockWhenAuthored: false })).name, 'Gus J')
    })

    test('a deleted item still counts as authored (other clients saw the persona on it)', async () => {
      const { store, code } = await fresh()
      await store.joinParticipant(code, guest.uid, persona('Gus G'))
      await store.applyOps(code, [add('a')], guest)
      await store.applyOps(code, [op({ op: 'delete', id: 'a' })], guest)
      assert.equal(await store.countAuthoredItems(code, guest.uid), 1)
      await assert.rejects(() => store.updateParticipant(code, guest.uid, persona('Gus K')), (e) => e.code === 'PERSONA_LOCKED')
    })

    test('items are stamped with the actor name and avatar', async () => {
      const { store, code } = await fresh()
      const [item] = (await store.applyOps(code, [add('a')], { ...guest, name: 'Pat', avatar: { ...AV, eyes: 6 } })).applied
      assert.deepEqual([item.authorUid, item.authorName, item.authorAvatar], [guest.uid, 'Pat', { ...AV, eyes: 6 }])
    })
  })
}

defineSuite('memory store participants', () => createMemoryStore())

// Opt-in: needs a reachable MongoDB. Never runs in the default test run.
const wantMongo = process.env.KM_TEST_MONGO === '1' && !!process.env.MONGODB_URI
let mongoClient
let mongoStore
defineSuite('mongo store participants', () => mongoStore, {
  skip: wantMongo ? false : 'set KM_TEST_MONGO=1 and MONGODB_URI to run the Mongo suite',
})
if (wantMongo) {
  const { MongoClient } = await import('mongodb')
  before(async () => {
    mongoClient = await new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 }).connect()
    mongoStore = createMongoStore(mongoClient, 'retrospace_test_participants')
  })
  after(async () => {
    try { await mongoClient.db('retrospace_test_participants').dropDatabase() } finally { await mongoClient.close() }
  })
}

// --- the Mongo participant logic, against a scripted collection (the real Mongo suite is opt-in) ---------------------
function fakeMongo(handlers) {
  const calls = []
  const col = (name) => new Proxy({}, {
    get: (_, method) => async (...args) => {
      calls.push([name, method, ...args])
      if (method === 'createIndex') return 'ok'
      return handlers[`${name}.${method}`]?.(...args)
    },
  })
  return { store: createMongoStore({ db: () => ({ collection: col }) }, 'fake'), calls }
}
const dup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 })

// Tests that check the exact calls made to the database with plain data run without an encryption key (the encrypted form
// is covered by seal-store.test.mjs and, against a real MongoDB, by seal-mongo.test.mjs).
const unsealed = (fn) => async (...args) => {
  const key = process.env.DATA_ENCRYPTION_KEY
  delete process.env.DATA_ENCRYPTION_KEY
  try { return await fn(...args) } finally { if (key !== undefined) process.env.DATA_ENCRYPTION_KEY = key }
}

test('mongo indexes: unique {boardCode, uid} and unique {boardCode, nameLower} (no exemptions)', async () => {
  const { store, calls } = fakeMongo({})
  await store.getParticipant('ABCDEF', 'KM-A')
  const idx = calls.filter((c) => c[0] === 'participants' && c[1] === 'createIndex').map((c) => c.slice(2))
  assert.deepEqual(idx, [
    [{ boardCode: 1, uid: 1 }, { unique: true }],
    [{ boardCode: 1, nameLower: 1 }, { unique: true }],
  ])
})

test('mongo joinParticipant upserts with $setOnInsert, the folded name key included, and nothing else', unsealed(async () => {
  const stored = { boardCode: 'ABCDEF', uid: 'KM-A', name: 'Ann' }
  const { store, calls } = fakeMongo({ 'participants.findOne': () => stored })
  assert.equal(await store.joinParticipant('ABCDEF', 'KM-A', persona('Ann')), stored)
  const [, , filter, update, options] = calls.find((c) => c[1] === 'updateOne')
  assert.deepEqual(filter, { boardCode: 'ABCDEF', uid: 'KM-A' })
  assert.deepEqual(Object.keys(update), ['$setOnInsert'])
  assert.equal(update.$setOnInsert.nameLower, 'ann')
  assert.equal('nameUniq' in update.$setOnInsert, false)
  assert.deepEqual(options, { upsert: true })
  await store.joinParticipant('ABCDEF', 'KM-B', persona('Olive', 'account'))
  assert.equal(calls.filter((c) => c[1] === 'updateOne').at(-1)[3].$setOnInsert.nameLower, 'olive')
}))

test('mongo joinParticipant: losing the upsert race for one uid returns the winner; a name clash is rethrown', async () => {
  const winner = { boardCode: 'ABCDEF', uid: 'KM-A', name: 'Ann' }
  const race = fakeMongo({ 'participants.updateOne': () => { throw dup() }, 'participants.findOne': () => winner })
  assert.equal(await race.store.joinParticipant('ABCDEF', 'KM-A', persona('Ann')), winner)
  const clash = fakeMongo({ 'participants.updateOne': () => { throw dup() }, 'participants.findOne': () => null })
  await assert.rejects(() => clash.store.joinParticipant('ABCDEF', 'KM-B', persona('Ann')), (e) => e.code === 11000)
  const broken = fakeMongo({ 'participants.updateOne': () => { throw new Error('network') } })
  await assert.rejects(() => broken.store.joinParticipant('ABCDEF', 'KM-B', persona('Ann')), /network/)
})

test('mongo updateParticipant checks authored items first unless the lock is off, and sets the persona fields', unsealed(async () => {
  const locked = fakeMongo({ 'items.countDocuments': () => 1 })
  await assert.rejects(() => locked.store.updateParticipant('ABCDEF', 'KM-A', persona('Ann')), (e) => e.code === 'PERSONA_LOCKED')
  assert.equal(locked.calls.some((c) => c[1] === 'findOneAndUpdate'), false)
  assert.deepEqual(locked.calls.find((c) => c[1] === 'countDocuments').slice(2), [{ boardCode: 'ABCDEF', authorUid: 'KM-A' }, { limit: 1 }])

  const free = fakeMongo({ 'items.countDocuments': () => 0, 'participants.findOneAndUpdate': () => ({ name: 'Ann' }) })
  assert.deepEqual(await free.store.updateParticipant('ABCDEF', 'KM-A', persona('Ann')), { name: 'Ann' })
  const [, , filter, update] = free.calls.find((c) => c[1] === 'findOneAndUpdate')
  assert.deepEqual(filter, { boardCode: 'ABCDEF', uid: 'KM-A' })
  assert.deepEqual(Object.keys(update), ['$set'])
  assert.equal(update.$set.nameLower, 'ann')

  const owner = fakeMongo({ 'participants.findOneAndUpdate': () => ({ name: 'Olive' }) })
  await owner.store.updateParticipant('ABCDEF', 'KM-A', persona('Olive', 'account'), { lockWhenAuthored: false })
  assert.equal(owner.calls.some((c) => c[1] === 'countDocuments'), false, 'no lock check for the owner')
}))

test('mongo participant reads hide _id, and deleteBoard clears participants', async () => {
  const { store, calls } = fakeMongo({})
  await store.getParticipant('ABCDEF', 'KM-A')
  await store.deleteBoard('ABCDEF')
  const read = calls.find((c) => c[0] === 'participants' && c[1] === 'findOne')
  assert.deepEqual(read.slice(2), [{ boardCode: 'ABCDEF', uid: 'KM-A' }, { projection: { _id: 0 } }])
  assert.ok(calls.some((c) => c[0] === 'participants' && c[1] === 'deleteMany' && c[2].boardCode === 'ABCDEF'))
})
