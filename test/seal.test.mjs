import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sealConfig, sealValue, openValue, sealDoc, openDoc, sealUpdate, sealState, blind, isSealed } from '../src/lib/seal.js'

const key = () => randomBytes(32).toString('base64')
const cfg = (extra = {}) => sealConfig({ DATA_ENCRYPTION_KEY: key(), ...extra })

test('config: no key means not configured; keys must be 32 bytes in base64 or hex; quotes from a dashboard are tolerated', () => {
  assert.equal(sealConfig({}).configured, false)
  assert.equal(sealConfig({ DATA_ENCRYPTION_KEY: key() }).writing, false, 'a key alone does not turn writing on')
  assert.equal(sealConfig({ DATA_ENCRYPTION_KEY: key(), DATA_ENCRYPTION_WRITE: 'on' }).writing, true)
  assert.equal(sealConfig({ DATA_ENCRYPTION_WRITE: 'on' }).writing, false, 'writing needs a key')
  assert.equal(sealConfig({ DATA_ENCRYPTION_KEY: `"${key()}"` }).configured, true)
  assert.equal(sealConfig({ DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex') }).configured, true)
  assert.throws(() => sealConfig({ DATA_ENCRYPTION_KEY: 'short' }), /32 bytes/)
  assert.throws(() => sealConfig({ DATA_ENCRYPTION_KEY: key(), DATA_ENCRYPTION_KEYS_OLD: 'not json' }), /JSON/)
})

test('a value round trips, is not readable, and differs every time (fresh nonce)', () => {
  const c = cfg()
  const a = sealValue(c, 'ABC234', 'items:ABC234/n1:data', { text: 'Secret retro note' })
  const b = sealValue(c, 'ABC234', 'items:ABC234/n1:data', { text: 'Secret retro note' })
  assert.ok(isSealed(a) && a !== b)
  assert.ok(!a.includes('Secret') && !Buffer.from(a.split('.')[3], 'base64url').toString('latin1').includes('Secret'))
  assert.deepEqual(openValue(c, 'ABC234', 'items:ABC234/n1:data', a), { text: 'Secret retro note' })
})

test('a ciphertext fails to open with the wrong key, board, field or record, or when altered', () => {
  const c = cfg()
  const s = sealValue(c, 'ABC234', 'items:ABC234/n1:data', 'hello')
  assert.throws(() => openValue(cfg(), 'ABC234', 'items:ABC234/n1:data', s)) // another key
  assert.throws(() => openValue(c, 'ZZZZ99', 'items:ABC234/n1:data', s)) // another board
  assert.throws(() => openValue(c, 'ABC234', 'items:ABC234/n1:authorName', s)) // another field
  assert.throws(() => openValue(c, 'ABC234', 'items:ABC234/n2:data', s)) // another record
  const parts = s.split('.')
  const raw = Buffer.from(parts[3], 'base64url')
  raw[0] ^= 1
  assert.throws(() => openValue(c, 'ABC234', 'items:ABC234/n1:data', [...parts.slice(0, 3), raw.toString('base64url')].join('.')))
})

test('rotation: values sealed under the old key open once it is listed as an old key, new ones use the new key', () => {
  const oldKey = key()
  const before = sealConfig({ DATA_ENCRYPTION_KEY: oldKey, DATA_ENCRYPTION_KEY_ID: 'k1' })
  const s = sealValue(before, 'ABC234', 'a', 'x')
  const after = sealConfig({ DATA_ENCRYPTION_KEY: key(), DATA_ENCRYPTION_KEY_ID: 'k2', DATA_ENCRYPTION_KEYS_OLD: JSON.stringify({ k1: oldKey }) })
  assert.equal(openValue(after, 'ABC234', 'a', s), 'x')
  assert.match(sealValue(after, 'ABC234', 'a', 'y'), /^enc1\.k2\./)
  assert.throws(() => openValue(sealConfig({ DATA_ENCRYPTION_KEY: key(), DATA_ENCRYPTION_KEY_ID: 'k2' }), 'ABC234', 'a', s), /No data encryption key/)
})

const item = { boardCode: 'ABC234', id: 'n1', kind: 'note', x: 1, y: 2, w: 200, h: 100, deleted: false, updatedAt: 5, authorUid: 'KM-AAAA', authorName: 'Ann', authorAvatar: { bg: 1 }, data: { text: 'Pairing helped' } }

test('an item is sealed in its content fields only; the plain ones stay queryable; opening restores it exactly', () => {
  const c = cfg()
  const s = sealDoc(c, 'items', item)
  assert.ok(isSealed(s.data) && isSealed(s.authorName) && isSealed(s.authorAvatar))
  assert.deepEqual([s.boardCode, s.id, s.kind, s.x, s.deleted, s.updatedAt, s.authorUid], ['ABC234', 'n1', 'note', 1, false, 5, 'KM-AAAA'])
  assert.deepEqual(s.enc, { v: 1, kid: 'k1' })
  assert.ok(!JSON.stringify(s).includes('Pairing') && !JSON.stringify(s).includes('Ann'))
  assert.deepEqual(openDoc(c, 'items', s), item)
  assert.deepEqual(sealDoc(c, 'items', s).data, s.data) // sealing twice leaves sealed fields alone
})

test('a legacy plain document is returned as it is; mixed documents open field by field', () => {
  const c = cfg()
  assert.deepEqual(openDoc(c, 'items', item), item)
  const mixed = { ...item, data: sealValue(c, 'ABC234', 'items:ABC234/n1:data', { text: 'new' }) }
  assert.deepEqual(openDoc(c, 'items', mixed), { ...item, data: { text: 'new' } })
  assert.equal(openDoc(c, 'items', null), null)
})

test('a sealed document cannot be read without its key, with a clear error and not garbage', () => {
  const s = sealDoc(cfg(), 'items', item)
  assert.throws(() => openDoc(sealConfig({}), 'items', s), /No data encryption key/)
})

test('boards seal the title, recipient, summary and wheel and keep the code, owner and flags', () => {
  const c = cfg()
  const board = { code: 'ABC234', type: 'event', ownerId: 'u1', title: 'Friday raffle', recipient: { name: 'Maria' }, summary: { text: 'x' }, wheel: { participants: [{ name: 'Maria' }] }, status: 'open', rev: 3 }
  const s = sealDoc(c, 'boards', board)
  assert.deepEqual([s.code, s.type, s.ownerId, s.status, s.rev], ['ABC234', 'event', 'u1', 'open', 3])
  assert.ok(['title', 'recipient', 'summary', 'wheel'].every((f) => isSealed(s[f])))
  assert.deepEqual(openDoc(c, 'boards', s), board)
})

test('participants: the name is sealed, a blind key replaces nameLower, and opening restores the legacy shape', () => {
  const c = cfg()
  const p = { boardCode: 'ABC234', uid: 'KM-AAAA', kind: 'custom', name: 'Maria Santos', nameLower: 'maria santos', avatar: { bg: 1 }, joinedAt: 5 }
  const s = sealDoc(c, 'participants', p)
  assert.ok(isSealed(s.name) && isSealed(s.avatar))
  assert.ok(s.nameLower && s.nameLower !== 'maria santos' && !s.nameLower.includes('maria')) // the field stays (the unique index needs it) but holds a key, not the name
  assert.ok(!JSON.stringify(s).toLowerCase().includes('maria'))
  assert.deepEqual(openDoc(c, 'participants', s), p)
  const same = sealDoc(c, 'participants', { ...p, uid: 'KM-BBBB', name: 'MARIA  SANTOS', nameLower: 'maria santos' })
  assert.equal(same.nameLower, s.nameLower) // the same name on the same board collides, as before
  assert.notEqual(sealDoc(c, 'participants', { ...p, uid: 'KM-CCCC', name: 'John', nameLower: 'john' }).nameLower, s.nameLower) // different names never do
  assert.notEqual(sealDoc(c, 'participants', { ...p, boardCode: 'ZZZZ99' }).nameLower, s.nameLower)
})

test('users: name and email are sealed, the email blind key is global so a login can find the account', () => {
  const c = cfg()
  const u = { id: 'u1', email: 'ann@example.com', name: 'Ann', passwordHash: 'scrypt$x', createdAt: 5 }
  const s = sealDoc(c, 'users', u)
  assert.ok(isSealed(s.email) && isSealed(s.name) && s.passwordHash === 'scrypt$x')
  assert.equal(s.emailIdx, blind(c, 'users-email', 'ann@example.com'))
  assert.ok(!JSON.stringify(s).includes('ann@example.com'))
  assert.deepEqual(openDoc(c, 'users', s), u)
})

test('people seal everything except their identity and timestamps', () => {
  const c = cfg()
  const p = { _id: 'm1', boardCode: 'ABC234', id: 'p1', name: 'Ann', birthday: '1990-02-03', createdAt: 1 }
  const s = sealDoc(c, 'people', p)
  assert.ok(isSealed(s.name) && isSealed(s.birthday))
  assert.deepEqual([s._id, s.boardCode, s.id, s.createdAt], ['m1', 'ABC234', 'p1', 1])
  assert.deepEqual(openDoc(c, 'people', s), p)
})

test('updates: $set of content fields is sealed using the identity in the filter; plain fields and counters are untouched', () => {
  const c = cfg()
  const u = sealUpdate(c, 'boards', { code: 'ABC234' }, { $set: { title: 'New title', wheel: { a: 1 }, status: 'closed', updatedAt: 9 }, $inc: { rev: 1 } })
  assert.ok(isSealed(u.$set.title) && isSealed(u.$set.wheel))
  assert.deepEqual([u.$set.status, u.$set.updatedAt, u.$inc], ['closed', 9, { rev: 1 }])
  assert.equal(openValue(c, 'ABC234', 'boards:ABC234:title', u.$set.title), 'New title')
  const plain = { $set: { status: 'closed' }, $max: { lastTs: 5 } }
  assert.equal(sealUpdate(c, 'boards', { code: 'ABC234' }, plain), plain)
  assert.throws(() => sealUpdate(c, 'items', { id: 'n1' }, { $set: { data: { text: 'x' } } }), /identity/)
})

test('an update of a participant name replaces the readable lookup key with a blind one', () => {
  const c = cfg()
  const u = sealUpdate(c, 'participants', { boardCode: 'ABC234', uid: 'KM-AAAA' }, { $set: { name: 'Maria', nameLower: 'maria', avatar: { bg: 2 }, updatedAt: 3 } })
  assert.ok(isSealed(u.$set.name) && u.$set.nameLower && u.$set.nameLower !== 'maria')
  assert.equal(u.$unset, undefined)
})

test('sealState counts what is still readable, for the backfill report', () => {
  const c = cfg()
  assert.deepEqual(sealState('items', item), { sealed: 0, plain: 3 })
  assert.deepEqual(sealState('items', sealDoc(c, 'items', item)), { sealed: 3, plain: 0 })
  assert.deepEqual(sealState('items', { ...sealDoc(c, 'items', item), authorName: 'Ann' }), { sealed: 2, plain: 1 })
})
