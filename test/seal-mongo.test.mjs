// The encryption against a REAL MongoDB, in its own throwaway database (dropped at the end). Skipped unless
// KM_TEST_MONGO=1 and MONGODB_URI are set. Uses a random key made here, never a real one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const want = process.env.KM_TEST_MONGO === '1' && !!process.env.MONGODB_URI
const DB = `retrospace_seal_test_${randomBytes(3).toString('hex')}`
const KEY = randomBytes(32).toString('base64')

test('real MongoDB: legacy records stay readable, new ones are sealed, backfill and undo work, uniqueness holds', { skip: want ? false : 'set KM_TEST_MONGO=1 and MONGODB_URI' }, async () => {
  const { MongoClient } = await import('mongodb')
  const { createMongoStore } = await import('../src/lib/store.js')
  const { validateOp } = await import('../src/lib/validate.js')
  const { sealConfig } = await import('../src/lib/seal.js')
  const { backfill } = await import('../src/lib/sealBackfill.js')
  const client = await new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).connect()
  const withKey = (key, fn) => { const before = process.env.DATA_ENCRYPTION_KEY; if (key) process.env.DATA_ENCRYPTION_KEY = key; else delete process.env.DATA_ENCRYPTION_KEY; try { return fn() } finally { if (before === undefined) delete process.env.DATA_ENCRYPTION_KEY; else process.env.DATA_ENCRYPTION_KEY = before } }
  const mk = (key) => withKey(key, () => createMongoStore(client, DB))
  const note = (id, text) => validateOp({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, w: 200, h: 120, data: { text } } }).op
  const actor = (uid) => ({ uid, name: 'Real Mongo Person', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }, isOwner: true })
  const board = { code: 'SEAL01', type: 'workshop', template: 'blank', title: 'Confidential roadmap', recipient: null, ownerId: 'u1', createdBy: 'u1', theme: { bg: '#fff' }, vote: { active: false, perPerson: 3 }, wheel: { participants: [{ name: 'Maria Quiet' }] } }
  const dump = async () => JSON.stringify(await Promise.all(['boards', 'items', 'participants', 'users', 'templates'].map((c) => client.db(DB).collection(c).find({}).toArray())))
  try {
    // 1. the app as it is in production now: no key, plain records
    const legacy = await mk(null)
    await legacy.createBoard(board)
    await legacy.joinParticipant('SEAL01', 'KM-OLD1', { kind: 'custom', name: 'Old Timer', avatar: { bg: 1 } })
    await legacy.applyOps('SEAL01', [note('old1', 'written before encryption')], actor('KM-OLD1'))
    await legacy.createUser({ id: 'u9', email: 'old@example.com', name: 'Old Account', passwordHash: 'h', createdAt: 1 })
    assert.ok((await dump()).includes('written before encryption'))

    // 2. the new code with a key over the same database: old records read fine, new ones are sealed
    const store = await mk(KEY)
    assert.equal((await store.getBoard('SEAL01')).title, 'Confidential roadmap')
    assert.equal((await store.listItems('SEAL01'))[0].data.text, 'written before encryption')
    assert.equal((await store.getUserByEmail('OLD@example.com')).id, 'u9')
    await store.applyOps('SEAL01', [note('new1', 'written after encryption')], actor('KM-NEW1'))
    await store.joinParticipant('SEAL01', 'KM-NEW1', { kind: 'custom', name: 'Fresh Person', avatar: { bg: 1 } })
    await store.createUser({ id: 'u1', email: 'New@Example.com', name: 'New Account', passwordHash: 'h', createdAt: 1 })
    let raw = await dump()
    assert.ok(!raw.includes('written after encryption') && !raw.includes('Fresh Person') && !raw.includes('new@example.com') && !raw.includes('New Account'))
    assert.ok(raw.includes('written before encryption')) // the old ones are untouched until the backfill
    assert.deepEqual((await store.listItems('SEAL01')).map((i) => i.data.text).sort(), ['written after encryption', 'written before encryption'])

    // 3. uniqueness without readable values, against real unique indexes
    await assert.rejects(store.createUser({ id: 'ux', email: 'NEW@example.com', name: 'Dup', passwordHash: 'h', createdAt: 2 }), (e) => e.code === 11000)
    await assert.rejects(store.createUser({ id: 'uy', email: 'old@example.com', name: 'Dup', passwordHash: 'h', createdAt: 2 }), (e) => e.code === 11000)
    await assert.rejects(store.joinParticipant('SEAL01', 'KM-NEW2', { kind: 'custom', name: 'fresh  person', avatar: { bg: 1 } }), (e) => e.code === 11000)
    await assert.rejects(store.joinParticipant('SEAL01', 'KM-NEW3', { kind: 'custom', name: 'old timer', avatar: { bg: 1 } }), (e) => e.code === 11000)

    // 4. the backfill: dry run writes nothing, apply seals the rest, a second run has nothing left
    const cfg = withKey(KEY, () => sealConfig())
    const before = await dump()
    const dry = await backfill(client.db(DB), cfg)
    assert.equal(await dump(), before)
    assert.ok(dry.items.changed >= 1 && dry.users.changed >= 1)
    const done = await backfill(client.db(DB), cfg, { apply: true })
    assert.equal(Object.values(done).reduce((n, r) => n + r.failed + r.skipped, 0), 0)
    raw = await dump()
    for (const s of ['written before encryption', 'Old Timer', 'old@example.com', 'Old Account', 'Confidential roadmap', 'Maria Quiet']) assert.ok(!raw.includes(s), s)
    assert.equal((await store.listItems('SEAL01')).length, 2)
    assert.equal((await store.getBoard('SEAL01')).wheel.participants[0].name, 'Maria Quiet')
    assert.equal((await store.getUserByEmail('old@example.com')).name, 'Old Account')
    assert.equal(Object.values(await backfill(client.db(DB), cfg, { apply: true })).reduce((n, r) => n + r.changed, 0), 0)

    // 5. and back: decrypt puts every record back to plain
    await backfill(client.db(DB), cfg, { apply: true, mode: 'decrypt' })
    raw = await dump()
    assert.ok(raw.includes('written after encryption') && raw.includes('Old Timer') && raw.includes('Confidential roadmap'))
    const keyless = await mk(null)
    assert.equal((await keyless.getBoard('SEAL01')).title, 'Confidential roadmap')
  } finally {
    await client.db(DB).dropDatabase()
    await client.close()
  }
})
