import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '../src/lib/store.js'
import { cachedParticipant, forgetParticipant, publicPersona, publicParticipant, resolvePersona } from '../src/lib/participants.js'
import { avatarFromSeed } from '../src/lib/persona.js'

const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const setup = async () => {
  const store = createMemoryStore()
  await store.createBoard({ code: 'ABCDEF', type: 'workshop', template: 'blank', title: 'T', ownerId: 'u_1', createdBy: 'u_1' })
  return store
}

test('public views carry no more than the persona fields', () => {
  const rec = { boardCode: 'ABCDEF', uid: 'KM-A', kind: 'custom', name: 'Ann', nameLower: 'ann', avatar: AV, joinedAt: 1, updatedAt: 2, userId: 'u_1', email: 'a@b.c' }
  assert.deepEqual(publicPersona(rec), { kind: 'custom', name: 'Ann', avatar: AV })
  assert.deepEqual(publicParticipant(rec), { uid: 'KM-A', name: 'Ann', avatar: AV, kind: 'custom' })
  assert.equal(publicPersona(null), null)
})

test('resolvePersona creates the account persona for the owner only, once', async () => {
  const store = await setup()
  const user = { id: 'u_1', name: 'Dana', email: 'dana@example.com' }
  assert.equal(await resolvePersona(store, 'ABCDEF', 'KM-A', { role: 'guest', user }), null, 'a guest has to choose')
  assert.equal(await resolvePersona(store, 'ABCDEF', 'KM-A', { role: 'guest' }), null)
  const p = await resolvePersona(store, 'ABCDEF', 'KM-A', { role: 'owner', user })
  assert.deepEqual([p.kind, p.name, p.avatar], ['account', 'Dana', avatarFromSeed('u_1')])
  assert.ok(!JSON.stringify(p).includes('dana@example.com'))
  assert.deepEqual(await resolvePersona(store, 'ABCDEF', 'KM-A', { role: 'owner', user: { ...user, name: 'Renamed' } }), p, 'an existing record is kept')
})

test('cachedParticipant reads the store once per window, forgets on demand, and never caches a miss', async () => {
  const store = await setup()
  let reads = 0
  const counting = { getParticipant: (...a) => { reads++; return store.getParticipant(...a) } }
  assert.equal(await cachedParticipant(counting, 'ABCDEF', 'KM-A', 1000), null)
  assert.equal(await cachedParticipant(counting, 'ABCDEF', 'KM-A', 1000), null)
  assert.equal(reads, 2, 'misses are not cached')
  await store.joinParticipant('ABCDEF', 'KM-A', { kind: 'custom', name: 'Ann', avatar: AV })
  assert.equal((await cachedParticipant(counting, 'ABCDEF', 'KM-A', 2000)).name, 'Ann')
  await cachedParticipant(counting, 'ABCDEF', 'KM-A', 3000)
  assert.equal(reads, 3, 'a hit inside the window does not read')
  await store.updateParticipant('ABCDEF', 'KM-A', { kind: 'custom', name: 'Ann B', avatar: AV })
  assert.equal((await cachedParticipant(counting, 'ABCDEF', 'KM-A', 4000)).name, 'Ann', 'stale until forgotten or expired')
  forgetParticipant('ABCDEF', 'KM-A')
  assert.equal((await cachedParticipant(counting, 'ABCDEF', 'KM-A', 5000)).name, 'Ann B')
  assert.equal((await cachedParticipant(counting, 'ABCDEF', 'KM-A', 5000 + 15_001)).name, 'Ann B')
  assert.equal(reads, 5, 'expired entries are re-read')
})

test('the cache is bounded', async () => {
  const fake = { getParticipant: async (c, u) => ({ uid: u, name: u }) }
  for (let i = 0; i < 2100; i++) await cachedParticipant(fake, 'BOUNDS', `KM-${i}`, 1)
  assert.ok(globalThis._rsPersonaCache.size <= 2000)
})
