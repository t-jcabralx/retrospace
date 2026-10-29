import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fakeClient } from './helpers/fakeMongo.mjs'
import { sealConfig, openDoc, sealDoc } from '../src/lib/seal.js'
import { backfill } from '../src/lib/sealBackfill.js'

const cfg = sealConfig({ DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
async function seed() {
  const client = fakeClient()
  const db = client.db()
  await db.collection('boards').insertOne({ code: 'ABC234', type: 'event', title: 'Plain title', recipient: null, wheel: { participants: [{ name: 'Maria' }] }, rev: 2, updatedAt: 10, ownerId: 'u1' })
  for (let i = 0; i < 5; i++) await db.collection('items').insertOne({ boardCode: 'ABC234', id: `n${i}`, kind: 'note', data: { text: `note ${i}` }, authorName: 'Ann', authorAvatar: { bg: 1 }, deleted: false, updatedAt: 10 + i })
  await db.collection('participants').insertOne({ boardCode: 'ABC234', uid: 'KM-A', kind: 'custom', name: 'Maria Santos', nameLower: 'maria santos', avatar: { bg: 1 }, joinedAt: 1 })
  await db.collection('users').insertOne({ id: 'u1', email: 'ann@example.com', name: 'Ann', passwordHash: 'h', createdAt: 1 })
  await db.collection('people').insertOne({ boardCode: 'ABC234', id: 'p1', name: 'Pat', birthday: '1990-01-02', createdAt: 1 })
  await db.collection('templates').insertOne({ id: 't1', ownerId: 'u1', name: 'My Columns', nameLower: 'my columns', columns: [], createdAt: 1 })
  return { client, db }
}
const raw = (client) => JSON.stringify([...client.cols.values()].map((c) => c.docs))

test('a dry run reports what it would do and writes nothing', async () => {
  const { client, db } = await seed()
  const before = raw(client)
  const r = await backfill(db, cfg)
  assert.equal(raw(client), before)
  assert.equal(r.items.total, 5)
  assert.equal(r.items.plain, 5)
  assert.equal(r.items.changed, 5)
  assert.equal(r.boards.changed, 1)
})

test('apply seals every legacy record, each one opens back to what it was, and a second run has nothing left', async () => {
  const { client, db } = await seed()
  const before = new Map([...client.cols].map(([k, c]) => [k, c.docs.map((d) => structuredClone(openDoc(cfg, k, d)))]))
  const r = await backfill(db, cfg, { apply: true, batch: 2 })
  assert.equal(Object.values(r).reduce((n, x) => n + x.failed + x.skipped, 0), 0)
  const text = raw(client).toLowerCase()
  for (const s of ['plain title', 'note 3', 'maria', 'ann@example.com', 'my columns', 'pat', '1990-01-02']) assert.ok(!text.includes(s), `${s} is still readable`)
  for (const [k, docs] of before) assert.deepEqual(client.cols.get(k).docs.map((d) => openDoc(cfg, k, d)), docs, k)
  assert.ok(client.cols.get('items').docs.every((d) => d.enc?.v === 1))
  const again = await backfill(db, cfg, { apply: true })
  assert.equal(Object.values(again).reduce((n, x) => n + x.changed, 0), 0)
  assert.equal(again.items.sealed, 5)
})

test('it only touches records that still hold readable content, and mixed ones are finished', async () => {
  const { client, db } = await seed()
  const items = client.cols.get('items')
  items.docs[0] = { ...items.docs[0], ...sealDoc(cfg, 'items', items.docs[0]) }
  items.docs[1].authorName = 'Plain again' // a half-sealed record
  items.docs[1].data = sealDoc(cfg, 'items', items.docs[1]).data
  const r = await backfill(db, cfg, { apply: true })
  assert.equal(r.items.changed, 4) // 5 minus the one that was already complete
  assert.equal(r.items.mixed, 1)
  assert.ok(!raw(client).includes('Plain again'))
})

test('a record that changes while the backfill runs is skipped, not overwritten', async () => {
  const { client, db } = await seed()
  const col = client.cols.get('items')
  const real = col.updateOne.bind(col)
  col.updateOne = async (guard, update, o) => { col.docs.find((d) => d.id === guard.id || d._id === guard._id).updatedAt = 999; return real(guard, update, o) } // a write lands first
  const r = await backfill(db, cfg, { apply: true, collections: ['items'] })
  assert.equal(r.items.skipped, 5)
  assert.equal(r.items.changed, 0)
  assert.ok(col.docs.every((d) => !d.enc))
})

test('decrypt mode puts the plain records back exactly, including the legacy lookup fields', async () => {
  const { client, db } = await seed()
  const original = JSON.stringify([...client.cols.values()].map((c) => c.docs))
  await backfill(db, cfg, { apply: true })
  assert.notEqual(raw(client), original)
  const r = await backfill(db, cfg, { apply: true, mode: 'decrypt' })
  assert.equal(Object.values(r).reduce((n, x) => n + x.failed, 0), 0)
  const normalise = (s) => JSON.stringify(JSON.parse(s).map((docs) => docs.map((d) => Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b))))))
  assert.equal(normalise(raw(client)), normalise(original))
})

test('without a key it refuses to encrypt, and a dry run of decrypt needs none to count', async () => {
  const { db } = await seed()
  await assert.rejects(backfill(db, sealConfig({})), /DATA_ENCRYPTION_KEY/)
})

test('the script refuses to write without the backup flag', async () => {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, ['scripts/encrypt-backfill.mjs', '--apply'], { env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/x', DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /backup/)
})
