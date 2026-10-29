import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fakeClient } from './helpers/fakeMongo.mjs'

delete process.env.DATA_ENCRYPTION_KEY
const { createMongoStore } = await import('../src/lib/store.js')
const { validateOp } = await import('../src/lib/validate.js')
const { isSealed } = await import('../src/lib/seal.js')

const KEY = randomBytes(32).toString('base64')
const withKey = async (key, fn, write = true) => {
  const before = [process.env.DATA_ENCRYPTION_KEY, process.env.DATA_ENCRYPTION_WRITE]
  if (key) process.env.DATA_ENCRYPTION_KEY = key; else delete process.env.DATA_ENCRYPTION_KEY
  if (write) process.env.DATA_ENCRYPTION_WRITE = 'on'; else delete process.env.DATA_ENCRYPTION_WRITE
  try { return await fn() } finally {
    for (const [i, n] of ['DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_WRITE'].entries()) if (before[i] === undefined) delete process.env[n]; else process.env[n] = before[i]
  }
}
// A store reads the key when it is created, so build it inside withKey.
const mk = (client, key, write = true) => withKey(key, async () => createMongoStore(client, 'test'), write)
const everything = (client) => JSON.stringify([...client.cols.values()].map((c) => c.docs))
const note = (id, text) => validateOp({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, w: 200, h: 120, data: { text } } }).op
const actor = (uid, isOwner = false) => ({ uid, name: 'Ann Secretname', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }, isOwner })
const board = (code = 'ABC234') => ({ code, type: 'workshop', template: 'blank', title: 'Confidential roadmap', recipient: { name: 'Maria Quiet' }, ownerId: 'u1', createdBy: 'u1', theme: { bg: '#fff' }, summary: null, vote: { active: false, perPerson: 3 } })

test('with a key, nothing a person typed is readable in the database, and the app still sees ordinary documents', async () => {
  const client = fakeClient()
  const store = await mk(client, KEY)
  await store.createBoard(board())
  await store.joinParticipant('ABC234', 'KM-AAAA', { kind: 'custom', name: 'Ann Secretname', avatar: { bg: 1 } })
  await store.applyOps('ABC234', [note('n1', 'Deploys were scary')], actor('KM-AAAA', true))
  await store.createUser({ id: 'u1', email: 'Ann@Example.com', name: 'Ann Secretname', passwordHash: 'scrypt$abc', createdAt: 1 })
  await store.createTemplate({ id: 't1', ownerId: 'u1', name: 'Our Retro Columns', columns: [{ title: 'Went well' }], createdAt: 1 })
  const raw = everything(client)
  for (const secret of ['Confidential roadmap', 'Maria Quiet', 'Deploys were scary', 'Ann Secretname', 'ann@example.com', 'Our Retro Columns', 'Went well']) assert.ok(!raw.toLowerCase().includes(secret.toLowerCase()), `${secret} is readable in the database`)
  assert.ok(raw.includes('scrypt$abc')) // the password hash is already a hash, and stays as it is

  assert.equal((await store.getBoard('ABC234')).title, 'Confidential roadmap')
  assert.deepEqual((await store.getBoard('ABC234')).recipient, { name: 'Maria Quiet' })
  assert.equal((await store.listItems('ABC234'))[0].data.text, 'Deploys were scary')
  assert.equal((await store.getParticipant('ABC234', 'KM-AAAA')).name, 'Ann Secretname')
  assert.equal((await store.getUserByEmail('ann@example.com')).name, 'Ann Secretname')
  assert.equal((await store.getUserById('u1')).email, 'ann@example.com')
  assert.equal((await store.listTemplates('u1'))[0].name, 'Our Retro Columns')
  assert.equal((await store.listBoardsByOwner('u1'))[0].title, 'Confidential roadmap')
})

test('records written before encryption keep working, and so do new ones next to them', async () => {
  const client = fakeClient()
  const legacy = await mk(client, null) // the app as it is in production today: no key
  await legacy.createBoard(board())
  await legacy.joinParticipant('ABC234', 'KM-OLD1', { kind: 'custom', name: 'Old Timer', avatar: { bg: 1 } })
  await legacy.applyOps('ABC234', [note('old1', 'written before')], actor('KM-OLD1', true))
  await legacy.createUser({ id: 'u9', email: 'old@example.com', name: 'Old', passwordHash: 'h', createdAt: 1 })
  assert.ok(everything(client).includes('written before')) // legacy data is plain, as in production

  const store = await mk(client, KEY) // the new code with a key, over the same database
  assert.equal((await store.getBoard('ABC234')).title, 'Confidential roadmap')
  assert.equal((await store.listItems('ABC234'))[0].data.text, 'written before')
  assert.equal((await store.getUserByEmail('OLD@example.com')).id, 'u9')
  assert.equal((await store.getParticipant('ABC234', 'KM-OLD1')).name, 'Old Timer')

  await store.applyOps('ABC234', [note('new1', 'written after')], actor('KM-NEW1', true))
  const items = await store.listItems('ABC234')
  assert.deepEqual(items.map((i) => i.data.text).sort(), ['written after', 'written before'])
  const raw = everything(client)
  assert.ok(!raw.includes('written after')) // new data is sealed
  assert.ok(raw.includes('written before')) // old data is untouched until it is rewritten or backfilled
})

test('updates seal what they set: a board patch, a persona change and a CAS write', async () => {
  const client = fakeClient()
  const store = await mk(client, KEY)
  await store.createBoard(board())
  await store.updateBoard('ABC234', { title: 'Renamed secretly', wheel: { participants: [{ name: 'Hidden Person' }] }, status: 'closed' })
  const b = await store.getBoard('ABC234')
  const cas = await store.casBoard('ABC234', b.rev, { summary: { text: 'Quiet summary', status: 'draft' } })
  assert.equal(cas.summary.text, 'Quiet summary')
  await store.joinParticipant('ABC234', 'KM-AAAA', { kind: 'custom', name: 'First Name', avatar: { bg: 1 } })
  await store.updateParticipant('ABC234', 'KM-AAAA', { kind: 'custom', name: 'Second Name', avatar: { bg: 2 } }, { lockWhenAuthored: false })
  const raw = everything(client)
  for (const s of ['Renamed secretly', 'Hidden Person', 'Quiet summary', 'First Name', 'Second Name']) assert.ok(!raw.includes(s), s)
  assert.equal((await store.getBoard('ABC234')).title, 'Renamed secretly')
  assert.equal((await store.getBoard('ABC234')).status, 'closed')
  assert.equal((await store.getParticipant('ABC234', 'KM-AAAA')).name, 'Second Name')
})

test('uniqueness still holds without readable names: one email per account, one name per board, one template name per owner', async () => {
  const client = fakeClient()
  const legacy = await mk(client, null)
  await legacy.createBoard(board())
  await legacy.joinParticipant('ABC234', 'KM-OLD1', { kind: 'custom', name: 'Taken Name', avatar: { bg: 1 } })
  await legacy.createUser({ id: 'u9', email: 'old@example.com', name: 'Old', passwordHash: 'h', createdAt: 1 })
  const store = await mk(client, KEY)
  await store.createUser({ id: 'u1', email: 'new@example.com', name: 'New', passwordHash: 'h', createdAt: 1 })
  for (const email of ['NEW@example.com', 'old@example.com']) await assert.rejects(store.createUser({ id: `x${email}`, email, name: 'Dup', passwordHash: 'h', createdAt: 1 }), (e) => e.code === 11000, email)
  await store.joinParticipant('ABC234', 'KM-NEW1', { kind: 'custom', name: 'Fresh Name', avatar: { bg: 1 } })
  await assert.rejects(store.joinParticipant('ABC234', 'KM-NEW2', { kind: 'custom', name: 'fresh  name', avatar: { bg: 1 } }), (e) => e.code === 11000) // a sealed name
  await assert.rejects(store.joinParticipant('ABC234', 'KM-NEW3', { kind: 'custom', name: 'taken name', avatar: { bg: 1 } }), (e) => e.code === 11000) // a legacy name
  await store.createTemplate({ id: 't1', ownerId: 'u1', name: 'My Columns', columns: [], createdAt: 1 })
  await assert.rejects(store.createTemplate({ id: 't2', ownerId: 'u1', name: 'my columns', columns: [], createdAt: 2 }), (e) => e.code === 11000)
  await store.createTemplate({ id: 't3', ownerId: 'u2', name: 'My Columns', columns: [], createdAt: 3 }) // another owner may reuse it
})

test('without a key and with no sealed records, the store behaves exactly as before and writes plain', async () => {
  const client = fakeClient()
  const store = await mk(client, null)
  await store.createBoard(board())
  await store.applyOps('ABC234', [note('n1', 'plain text')], actor('KM-AAAA', true))
  assert.ok(everything(client).includes('plain text') && everything(client).includes('Confidential roadmap'))
  assert.ok(![...client.cols.values()].some((c) => c.docs.some((d) => d.enc)))
  assert.equal((await store.listItems('ABC234'))[0].data.text, 'plain text')
})

test('sealed records without the key fail loudly instead of returning garbage or overwriting', async () => {
  const client = fakeClient()
  const sealed = await mk(client, KEY)
  await sealed.createBoard(board())
  const keyless = await mk(client, null)
  await assert.rejects(keyless.getBoard('ABC234'), /No data encryption key/)
})

test('the media budget still counts pictures when their contents are sealed', async () => {
  const client = fakeClient()
  const store = await mk(client, KEY)
  await store.createBoard(board())
  const img = validateOp({ op: 'add', item: { id: 'i1', kind: 'image', x: 1, y: 2, w: 100, h: 100, data: { src: `data:image/png;base64,${'A'.repeat(1000)}`, alt: 'x' } } })
  assert.ok(img.ok, img.error)
  const r = await store.applyOps('ABC234', [img.op], actor('KM-AAAA', true))
  assert.equal(r.applied.length, 1, JSON.stringify(r.rejected))
  assert.ok(isSealed([...client.cols.get('items').docs][0].data))
})

test('a key alone only reads: nothing new is sealed, and a sealed record still opens', async () => {
  const client = fakeClient()
  const writer = await mk(client, KEY)
  await writer.createBoard(board('SEAL02'))
  await writer.applyOps('SEAL02', [note('n1', 'Sealed before')], actor('KM-AAAA', true))
  assert.ok(!everything(client).includes('Sealed before'))
  const reader = await mk(client, KEY, false)
  assert.equal((await reader.getBoard('SEAL02')).title, 'Confidential roadmap')
  assert.equal((await reader.listItems('SEAL02'))[0].data.text, 'Sealed before')
  await reader.createBoard(board('PLAIN1'))
  await reader.applyOps('PLAIN1', [note('n2', 'Written in read-only mode')], actor('KM-BBBB', true))
  assert.ok(everything(client).includes('Written in read-only mode'), 'read-only mode must keep writing plain, as the version before it did')
  assert.ok(!client.cols.get('boards').docs.find((d) => d.code === 'PLAIN1').enc)
  const none = await mk(client, undefined)
  await none.createBoard(board('PLAIN2'))
  assert.ok(everything(client).includes('Confidential roadmap'))
})

test('a key that cannot be used does not stop the site unless writing is on', async () => {
  const { sealConfigForSite } = await import('../src/lib/seal.js')
  const bad = { DATA_ENCRYPTION_KEY: 'short' }
  const errors = []
  const was = console.error
  console.error = (m) => errors.push(m)
  try {
    const c = sealConfigForSite(bad)
    assert.equal(c.configured, false)
    assert.equal(c.writing, false)
    assert.match(c.error, /32 bytes/)
    assert.equal(errors.length, 1)
  } finally { console.error = was }
  assert.throws(() => sealConfigForSite({ ...bad, DATA_ENCRYPTION_WRITE: 'on' }), /32 bytes/)
})
