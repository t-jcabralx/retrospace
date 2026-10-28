import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { createMemoryStore, createMongoStore } = await import('../src/lib/store.js')
const { planTombstones, MAX_BANS, kickedEnvelope, tombstonesEnvelope } = await import('../src/lib/ownerTools.js')
const { getStore } = await import('../src/lib/store.js')
const { signTok } = await import('../src/lib/rt.js')
const { POST: rtSend } = await import('../src/app/api/rt/send/route.js')
const { GET: listRoute } = await import('../src/app/api/boards/[code]/participants/route.js')
const { planOps } = await import('../src/lib/plan.js')
const { authorize, HttpError, viewerBoard } = await import('../src/lib/access.js')
const { stripBoard } = await import('../src/lib/http.js')
const { publicId, mintGuest } = await import('../src/lib/guest.js')
const { shouldApply } = await import('../src/client/sync.js')
const { validateOp } = await import('../src/lib/validate.js')
const { generatePersona } = await import('../src/lib/persona.js')
const { newCode } = await import('../src/lib/ids.js')

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { PUT: personaRoute } = await import('../src/app/api/boards/[code]/persona/route.js')
const { GET: sinceRoute } = await import('../src/app/api/boards/[code]/since/route.js')
const { POST: rtJoin } = await import('../src/app/api/rt/join/route.js')
const { DELETE: kickRoute } = await import('../src/app/api/boards/[code]/participants/[id]/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const persona = (name) => ({ kind: 'custom', name, avatar: AV })
const op = (input) => { const r = validateOp(input); assert.ok(r.ok, r.error); return r.op }
const addNote = (id, extra = {}) => op({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, data: { text: id }, ...extra } })
const actor = (uid) => ({ uid, name: uid, avatar: AV, isOwner: false })

describe('planTombstones', () => {
  test('tombstones only live items of that author, monotonic above lastTs and each item', () => {
    const items = [
      { id: 'a', authorUid: 'KM-X', updatedAt: 100, deleted: false },
      { id: 'b', authorUid: 'KM-Y', updatedAt: 100, deleted: false },
      { id: 'c', authorUid: 'KM-X', updatedAt: 5000, deleted: false },
      { id: 'd', authorUid: 'KM-X', updatedAt: 1, deleted: true },
    ]
    const r = planTombstones({ lastTs: 200 }, items, 'KM-X', 150)
    assert.deepEqual(r.changed.map((i) => i.id), ['a', 'c'])
    assert.ok(r.changed.every((i) => i.deleted === true))
    assert.ok(r.changed[0].updatedAt > 200 && r.changed[1].updatedAt > r.changed[0].updatedAt && r.changed[1].updatedAt > 5000)
    assert.equal(r.lastTs, r.changed[1].updatedAt)
    assert.equal(planTombstones({ lastTs: 7 }, items, 'KM-NONE', 1).lastTs, 7)
  })

  test('a tombstone from removal equals the one a normal delete leaves (data, votes and reactions stripped)', () => {
    const board = { code: 'ABCDEF', type: 'workshop', lastTs: 10 }
    const item = { id: 'a', kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text: 'secret', color: 'yellow' }, votes: ['KM-Y'], reactions: { '👍': ['KM-Y'] }, authorUid: 'KM-X', authorName: 'Ann', deleted: false, updatedAt: 100, boardCode: 'ABCDEF' }
    const viaRemoval = planTombstones(board, [item], 'KM-X', 500).changed[0]
    const viaDelete = planOps(board, new Map([['a', item]]), [{ op: 'delete', id: 'a' }], { uid: 'KM-X', isOwner: false }, 500).applied[0]
    assert.deepEqual({ ...viaRemoval, updatedAt: 0 }, { ...viaDelete, updatedAt: 0 })
    assert.deepEqual(viaRemoval.data, {})
  })
})

describe('memory store removeParticipant', () => {
  const setup = async () => {
    const store = createMemoryStore()
    const b = await store.createBoard({ code: newCode(), type: 'workshop', template: 'blank', title: 'T', ownerId: 'u_0123456789abcdef' })
    await store.joinParticipant(b.code, 'KM-AAAA-AAAA-AAAA', persona('Ann'))
    await store.joinParticipant(b.code, 'KM-BBBB-BBBB-BBBB', persona('Bob'))
    await store.applyOps(b.code, [addNote('a1'), addNote('a2')], actor('KM-AAAA-AAAA-AAAA'))
    await store.applyOps(b.code, [addNote('b1')], actor('KM-BBBB-BBBB-BBBB'))
    return { store, code: b.code }
  }

  test('keeping items: row gone, name freed, id banned, items untouched', async () => {
    const { store, code } = await setup()
    const r = await store.removeParticipant(code, 'KM-AAAA-AAAA-AAAA')
    assert.deepEqual([r.existed, r.wasBanned, r.changed.length], [true, false, 0])
    assert.equal(await store.getParticipant(code, 'KM-AAAA-AAAA-AAAA'), null)
    assert.deepEqual((await store.getBoard(code)).bans, ['KM-AAAA-AAAA-AAAA'])
    assert.equal((await store.listItems(code)).length, 3)
    await store.joinParticipant(code, 'KM-CCCC-CCCC-CCCC', persona('Ann')) // the freed name
  })

  test('deleting items tombstones only theirs, monotonic, visible to itemsSince, and is idempotent', async () => {
    const { store, code } = await setup()
    const before = await store.getBoard(code)
    const r = await store.removeParticipant(code, 'KM-AAAA-AAAA-AAAA', { deleteItems: true })
    assert.deepEqual(r.changed.map((i) => i.id).sort(), ['a1', 'a2'])
    assert.ok(r.changed.every((i) => i.deleted && i.updatedAt > before.lastTs))
    assert.deepEqual((await store.listItems(code)).map((i) => i.id), ['b1'])
    const after = await store.getBoard(code)
    assert.equal(after.lastTs, Math.max(...r.changed.map((i) => i.updatedAt)))
    assert.equal((await store.itemsSince(code, before.lastTs)).filter((i) => i.deleted).length, 2)
    const again = await store.removeParticipant(code, 'KM-AAAA-AAAA-AAAA', { deleteItems: true })
    assert.deepEqual([again.existed, again.wasBanned, again.changed.length], [false, true, 0])
    assert.deepEqual((await store.getBoard(code)).bans, ['KM-AAAA-AAAA-AAAA'], 'no duplicate ban')
  })

  test('bans cannot be set through updateBoard, the ban list is capped, and unknown boards give null', async () => {
    const { store, code } = await setup()
    await store.updateBoard(code, { bans: ['KM-EVIL-EVIL-EVIL'], title: 'x' })
    assert.equal((await store.getBoard(code)).bans, undefined)
    for (let i = 0; i < MAX_BANS; i++) await store.removeParticipant(code, `KM-${String(i).padStart(4, '0')}-AAAA-AAAA`)
    await assert.rejects(() => store.removeParticipant(code, 'KM-ZZZZ-ZZZZ-ZZZZ'), (e) => e.code === 'BANS_FULL')
    assert.equal(await store.removeParticipant('NOBODY', 'KM-ZZZZ-ZZZZ-ZZZZ'), null)
  })
})

// A scripted Mongo client for removeParticipant: boards/items/participants arrays with the few operators it uses.
function fakeMongo(seed) {
  const data = { boards: seed.boards, items: seed.items, participants: seed.participants, log: [] }
  const match = (d, f) => Object.entries(f).every(([k, v]) => {
    if (k.startsWith('bans.')) return v.$exists === (d.bans?.[Number(k.slice(5))] !== undefined)
    if (v && typeof v === 'object' && '$exists' in v) return (k in d) === v.$exists
    return d[k] === v
  })
  const cursor = (rows) => ({ sort: () => cursor(rows), toArray: async () => structuredClone(rows) })
  const col = (name) => ({
    createIndex: async () => 'ok',
    findOne: async (f) => structuredClone(data[name].find((d) => match(d, f)) ?? null),
    find: (f) => cursor(data[name].filter((d) => match(d, f))),
    deleteOne: async (f) => { const i = data[name].findIndex((d) => match(d, f)); if (i >= 0) data[name].splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 } },
    updateOne: async (f, u) => {
      data.log.push([name, 'updateOne', f, u])
      const d = data[name].find((x) => match(x, f))
      if (!d) return { matchedCount: 0 }
      if (u.$addToSet) for (const [k, v] of Object.entries(u.$addToSet)) d[k] = [...new Set([...(d[k] ?? []), v])]
      if (u.$max) for (const [k, v] of Object.entries(u.$max)) d[k] = Math.max(d[k] ?? 0, v)
      return { matchedCount: 1 }
    },
    findOneAndUpdate: async (f, u) => {
      data.log.push([name, 'findOneAndUpdate', f, u])
      const d = data[name].find((x) => match(x, f))
      if (!d) return null
      Object.assign(d, structuredClone(u.$set))
      return structuredClone(d)
    },
  })
  return { data, store: createMongoStore({ db: () => ({ collection: col }) }, 'fake') }
}

describe('mongo store (scripted collections) removeParticipant', () => {
  const seed = () => ({
    boards: [{ code: 'ABCDEF', lastTs: 500, updatedAt: 500, ownerId: 'u_x' }],
    participants: [{ boardCode: 'ABCDEF', uid: 'KM-A', name: 'Ann' }, { boardCode: 'ABCDEF', uid: 'KM-B', name: 'Bob' }],
    items: [
      { boardCode: 'ABCDEF', id: 'i1', authorUid: 'KM-A', deleted: false, updatedAt: 600 },
      { boardCode: 'ABCDEF', id: 'i2', authorUid: 'KM-B', deleted: false, updatedAt: 100 },
    ],
  })

  test('bans first with $addToSet under the cap filter, deletes the row, keeps items by default', async () => {
    const { store, data } = fakeMongo(seed())
    const r = await store.removeParticipant('ABCDEF', 'KM-A')
    assert.deepEqual([r.existed, r.wasBanned, r.changed], [true, false, []])
    assert.deepEqual(data.boards[0].bans, ['KM-A'])
    assert.deepEqual(data.participants.map((p) => p.uid), ['KM-B'])
    assert.ok(data.items.every((i) => !i.deleted))
    const ban = data.log.find((l) => l[1] === 'updateOne')
    assert.deepEqual(ban[2], { code: 'ABCDEF', [`bans.${MAX_BANS - 1}`]: { $exists: false } })
    assert.deepEqual(ban[3], { $addToSet: { bans: 'KM-A' } })
  })

  test('with deleteItems only their live items are tombstoned (guarded, monotonic) and lastTs moves', async () => {
    const { store, data } = fakeMongo(seed())
    const r = await store.removeParticipant('ABCDEF', 'KM-A', { deleteItems: true })
    assert.deepEqual(r.changed.map((i) => [i.id, i.deleted]), [['i1', true]])
    assert.ok(r.changed[0].updatedAt > 600)
    assert.equal(data.items.find((i) => i.id === 'i2').deleted, false)
    assert.equal(data.boards[0].lastTs, r.changed[0].updatedAt)
    const guard = data.log.find((l) => l[1] === 'findOneAndUpdate')
    assert.equal(guard[2].updatedAt, 600, 'the write is pinned to the version it read')
    assert.deepEqual([guard[3].$set.data, guard[3].$set.votes, guard[3].$set.reactions], [{}, [], {}], 'a tombstone carries no data')
  })

  test('a full ban list refuses; an unknown board gives null; an already banned id is not re-added', async () => {
    const full = seed()
    full.boards[0].bans = Array.from({ length: MAX_BANS }, (_, i) => `KM-${i}`)
    await assert.rejects(() => fakeMongo(full).store.removeParticipant('ABCDEF', 'KM-NEW'), (e) => e.code === 'BANS_FULL')
    assert.equal(await fakeMongo(seed()).store.removeParticipant('NOPE00', 'KM-A'), null)
    const twice = fakeMongo(seed())
    await twice.store.removeParticipant('ABCDEF', 'KM-A')
    const r = await twice.store.removeParticipant('ABCDEF', 'KM-A')
    assert.deepEqual([r.existed, r.wasBanned], [false, true])
    assert.equal(twice.data.log.filter((l) => l[1] === 'updateOne').length, 1)
  })
})

describe('authorize ban matrix and guest-safe serialization', () => {
  const guestA = mintGuest()
  const guestB = mintGuest()
  const reqFor = (g) => new Request('http://localhost/x', { headers: g ? { cookie: g.cookie.split(';')[0] } : {} })
  const code = 'ABCDEF'
  const bannedBoard = { code, status: 'open', ownerId: 'u_owner', bans: [publicId(code, guestA.uid)] }
  const store = { getSessionByTokenHash: async () => null, getUserById: async () => null }

  test('a banned guest gets 403 on read and write, in every board state; others and cookie-less visitors pass', async () => {
    for (const opts of [{}, { write: true }]) {
      await assert.rejects(() => authorize(reqFor(guestA), bannedBoard, { ...opts, store }), (e) => e instanceof HttpError && e.status === 403 && e.message === 'You were removed from this board')
    }
    await assert.rejects(() => authorize(reqFor(guestA), { ...bannedBoard, passcodeHash: 'x', revoked: true }, { store }), (e) => e.message === 'You were removed from this board')
    assert.equal((await authorize(reqFor(guestB), bannedBoard, { store })).role, 'guest')
    assert.equal((await authorize(reqFor(null), bannedBoard, { store })).role, 'guest')
    assert.equal((await authorize(reqFor(guestA), { ...bannedBoard, bans: [] }, { store })).role, 'guest')
  })

  test('bans never appear in any board view, and the kicked envelope carries no cookie uid', () => {
    for (const role of ['guest', 'owner']) assert.equal('bans' in viewerBoard(bannedBoard, role), false)
    assert.equal('bans' in stripBoard(bannedBoard), false)
    const env = { t: 'kicked', from: 'KM-OWNR-OWNR-OWNR', id: publicId(code, guestA.uid) }
    assert.equal(JSON.stringify(env).includes(guestA.uid), false)
    assert.equal(shouldApply(env, { uid: 'KM-OTHR-OTHR-OTHR', cid: 'c1' }), true)
    assert.equal(shouldApply({ t: 'kicked', from: 'KM-X' }, { uid: 'KM-Y' }), false, 'no id, no kick')
    assert.deepEqual(Object.keys(kickedEnvelope('KM-OWNR-OWNR-OWNR', 'KM-GONE-GONE-GONE')).sort(), ['from', 'id', 't'])
    const tomb = tombstonesEnvelope('KM-OWNR-OWNR-OWNR', [{ id: 'a', deleted: true, data: {} }])
    assert.deepEqual([tomb.t, tomb.ops.length, shouldApply(tomb, { uid: 'KM-OTHR-OTHR-OTHR' })], ['ops', 1, true])
  })
})

// --- routes -------------------------------------------------------------------------------------------------------
const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`
const rawOf = (rsg) => rsg.split(';')[0].slice('rs_g='.length).split('.')[0]
async function call(handler, method, path, { body, cookie, code, params } = {}) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3430${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), code ? { params: Promise.resolve({ code, ...params }) } : undefined)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data, setCookies: res.headers.getSetCookie() }
}
async function signUp(name) {
  const r = await call(register, 'POST', '/api/auth/register', { body: { email: `${name.toLowerCase()}-${rnd()}@example.com`, name, password: 'correct horse battery' } })
  assert.equal(r.status, 200)
  return r.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0]
}
const snapshot = (code, cookie) => call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie })
async function browser(code) {
  const snap = await snapshot(code)
  const rsg = snap.setCookies.find((c) => c.startsWith('rs_g=')).split(';')[0]
  return { cookie: rsg, uid: snap.data.viewer.uid, raw: rawOf(rsg) }
}
async function guest(code, name) {
  const b = await browser(code)
  const r = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: b.cookie, body: { persona: persona(name) } })
  assert.equal(r.status, 200)
  return b
}
const ops = (code, cookie, list) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: list } })
const note = (id) => ({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text: id } } })
const kick = (code, id, cookie, q = '') => call(kickRoute, 'DELETE', `/api/boards/${code}/participants/${id}${q}`, { code, cookie, params: { id } })

const owner = await signUp('Dana')
const newBoard = async () => (await call(createBoard, 'POST', '/api/boards', { cookie: owner, body: { type: 'workshop', template: 'blank', title: 'T' } })).data.code

describe('DELETE /participants/[id]', () => {
  test('only the owner: 401 anonymous, 401 for a guest (no account), 403 for another account', async () => {
    const code = await newBoard()
    const g = await guest(code, 'Gus')
    const v = await guest(code, 'Vic')
    assert.equal((await kick(code, v.uid, undefined)).status, 401)
    assert.equal((await kick(code, v.uid, g.cookie)).status, 401)
    assert.equal((await kick(code, g.uid, g.cookie)).status, 401)
    assert.equal((await kick(code, v.uid, await signUp('Mallory'))).status, 403)
    assert.equal((await ops(code, v.cookie, [note('n1')])).status, 200, 'nothing happened to Vic')
  })

  test('validation: bad id 400, unknown 404, bad items flag 400, the owner cannot remove themselves', async () => {
    const code = await newBoard()
    const mine = (await snapshot(code, owner)).data.viewer.uid
    assert.equal((await kick(code, 'nope', owner)).status, 400)
    assert.equal((await kick(code, 'KM-ZZZZ-ZZZZ-ZZZZ', owner)).status, 404)
    const g = await guest(code, 'Gus')
    assert.equal((await kick(code, g.uid, owner, '?items=2')).status, 400)
    const self = await kick(code, mine, owner)
    assert.equal(self.status, 400)
    assert.match(self.data.error, /yourself/)
    assert.equal((await ops(code, g.cookie, [note('n1')])).status, 200)
  })

  test('removal bans the guest on every route; the name is free; items kept by default', async () => {
    const code = await newBoard()
    const g = await guest(code, 'Gus')
    const keep = await guest(code, 'Keeper')
    assert.equal((await ops(code, g.cookie, [note('n1')])).data.applied.length, 1)
    const r = await kick(code, g.uid, owner)
    assert.deepEqual([r.data.removed, r.data.itemsDeleted, r.data.changed], [true, 0, []])
    for (const res of [
      await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: g.cookie }),
      await ops(code, g.cookie, [note('n2')]),
      await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: g.cookie, body: { persona: persona('Gus2') } }),
      await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code, cookie: g.cookie }),
      await call(rtJoin, 'POST', '/api/rt/join', { cookie: g.cookie, body: { code } }),
    ]) {
      assert.equal(res.status, 403)
      assert.equal(res.data.error, 'You were removed from this board')
    }
    const snap = await snapshot(code, owner)
    assert.ok(snap.data.items.some((i) => i.id === 'n1'), 'items kept')
    assert.equal(snap.data.participants.some((p) => p.uid === g.uid), false)
    assert.equal('bans' in snap.data.board, false)
    const other = await snapshot(code, keep.cookie)
    assert.equal(JSON.stringify(other.data).includes('bans'), false)
    assert.equal((await ops(code, keep.cookie, [note('k1')])).status, 200, 'others unaffected')
    const ownerWithBannedCookie = await snapshot(code, `${owner}; ${g.cookie}`)
    assert.equal(ownerWithBannedCookie.status, 200, 'the owner is exempt even in a browser that holds a banned guest cookie')
    assert.equal(ownerWithBannedCookie.data.viewer.role, 'owner')
    const fresh = await browser(code) // a new identity may take the freed name
    const reuse = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: fresh.cookie, body: { persona: persona('Gus') } })
    assert.equal(reuse.status, 200)
  })

  test('items=1 tombstones their live items only, and a second call is idempotent', async () => {
    const code = await newBoard()
    const g = await guest(code, 'Gus')
    const keep = await guest(code, 'Keeper')
    await ops(code, g.cookie, [note('g1'), note('g2')])
    await ops(code, keep.cookie, [note('k1')])
    const r = await kick(code, g.uid, owner, '?items=1')
    assert.deepEqual([r.data.removed, r.data.itemsDeleted, r.data.changed.map((i) => i.id).sort()], [true, 2, ['g1', 'g2']])
    assert.ok(r.data.changed.every((i) => i.deleted && Object.keys(i.data).length === 0), 'tombstones carry no data')
    const snap = await snapshot(code, owner)
    const ids = snap.data.items.map((i) => i.id)
    assert.ok(ids.includes('k1') && !ids.includes('g1') && !ids.includes('g2'))
    const again = await kick(code, g.uid, owner, '?items=1')
    assert.deepEqual([again.data.removed, again.data.itemsDeleted], [true, 0])
  })
})

describe('list and relay defence', () => {
  test('GET /participants is owner only and returns the public view', async () => {
    const code = await newBoard()
    const g = await guest(code, 'Gus')
    assert.equal((await call(listRoute, 'GET', `/api/boards/${code}/participants`, { code })).status, 401)
    assert.equal((await call(listRoute, 'GET', `/api/boards/${code}/participants`, { code, cookie: g.cookie })).status, 401)
    assert.equal((await call(listRoute, 'GET', `/api/boards/${code}/participants`, { code, cookie: await signUp('Mallory') })).status, 403)
    const ok = await call(listRoute, 'GET', `/api/boards/${code}/participants`, { code, cookie: owner })
    assert.equal(ok.status, 200)
    const p = ok.data.participants.find((x) => x.uid === g.uid)
    assert.deepEqual(Object.keys(p).sort(), ['avatar', 'kind', 'name', 'uid'])
    assert.equal(JSON.stringify(ok.data).includes(g.raw), false, 'no cookie uid')
    await kick(code, g.uid, owner)
    assert.equal((await call(listRoute, 'GET', `/api/boards/${code}/participants`, { code, cookie: owner })).data.participants.some((x) => x.uid === g.uid), false)
  })

  test('/api/rt/send refuses a banned id even with a valid token and a persona row (a race with the removal)', async () => {
    const code = await newBoard()
    const g = await guest(code, 'Gus')
    await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: owner, body: { patch: { throwables: { enabled: true, emojis: ['🎉'] } } } })
    await kick(code, g.uid, owner)
    await getStore().joinParticipant(code, g.uid, persona('Ghost')) // what an in-flight persona write could leave behind
    const res = await rtSend(new Request('http://localhost:3430/api/rt/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ code, uid: g.uid, tok: signTok(code, g.uid), msg: { t: 'throw', emoji: '🎉', x: 1, y: 1 } }) }))
    assert.equal(res.status, 403)
    assert.equal((await res.json()).error, 'You were removed from this board')
  })
})
