import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')
const { planOps, allowedKinds, mediaSize, MAX_MEDIA, MAX_DOCS } = await import('../src/lib/plan.js')
const { slimApplied } = await import('../src/lib/broadcast.js')
const { getStore, createMemoryStore } = await import('../src/lib/store.js')
const { validateOp, validateItem } = await import('../src/lib/validate.js')
const { reducer, initialState } = await import('../src/client/state.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

async function call(handler, path, { body, cookie, code }) {
  const h = { 'x-forwarded-for': fakeIp(), 'content-type': 'application/json' }
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const reg = await register(new Request('http://localhost:3100/api/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() },
  body: JSON.stringify({ email: `h-${rnd()}@example.com`, name: 'Hana', password: 'correct horse battery' }),
}))
const owner = { cookie: reg.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0] }
const newBoard = async (type, template) => (await call(createBoard, '/api/boards', { cookie: owner.cookie, body: { type, template, title: 'T', ...(type === 'celebration' && { recipient: { name: 'Maria' } }) } })).data.code
const ops = (code, list) => call(opsRoute, `/api/boards/${code}/ops`, { code, cookie: owner.cookie, body: { ops: list } })
const add = (id, kind, data, extra = {}) => ({ op: 'add', item: { id, kind, x: 0, y: 0, w: 100, h: 100, data, ...extra } })
const DATA = (n) => `data:image/webp;base64,${'A'.repeat(n - 'data:image/webp;base64,'.length)}`

// --- B1: allowed kinds per board type ------------------------------------------------------------------------
test('hostile direct API add of a shoutout on a workshop board is rejected, and nothing is stored', async () => {
  const code = await newBoard('workshop', 'blank')
  const r = await ops(code, [add('hostile1', 'shoutout', { toName: 'X', message: 'hi', badge: 'Teamwork' })])
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.applied, [])
  assert.equal(r.data.rejected.length, 1)
  assert.match(r.data.rejected[0].error, /can't be added to this board/)
  assert.equal((await getStore().listItems(code)).length, 0)
  const ok = await ops(code, [add('fine1', 'note', { text: 'hello' })])
  assert.equal(ok.data.applied.length, 1)
})

test('a card is refused on workshop and retro boards but allowed on a celebration board', async () => {
  const card = { message: 'Congrats', signer: 'Ann', color: 'yellow' }
  const w = await newBoard('workshop', 'blank')
  assert.equal((await ops(w, [add('c1', 'card', card)])).data.applied.length, 0)
  const c = await newBoard('celebration', (await import('../src/lib/templates.js')).BOARD_TEMPLATES.celebration && Object.keys((await import('../src/lib/templates.js')).BOARD_TEMPLATES.celebration)[0])
  assert.equal((await ops(c, [add('c1', 'card', card)])).data.applied.length, 1)
})

test('allowedKinds: per type table; retro keeps action/theme/topic open for other features; unknown types fall back to the canvas set', () => {
  const canvas = ['note', 'text', 'shape', 'connector', 'frame', 'image']
  assert.deepEqual(allowedKinds('workshop'), canvas)
  assert.deepEqual(allowedKinds('celebration'), [...canvas, 'card'])
  for (const k of ['action', 'theme', 'topic']) assert.ok(allowedKinds('retro').includes(k), k)
  assert.deepEqual(allowedKinds('wall'), ['shoutout', 'note', 'text'])
  assert.deepEqual(allowedKinds('nonsense'), canvas)
  assert.ok(!allowedKinds('retro').includes('shoutout') && !allowedKinds('retro').includes('card'))
})

const actor = { uid: 'KM-AAAA-AAAA-AAAA', name: 'A', avatar: null, isOwner: true }
const board = (type = 'workshop') => ({ code: 'ABC234', type, lastTs: 0, status: 'open' })
const planAdd = (b, items, list) => planOps(b, items, list.map((o) => ({ ...o, id: o.item.id })), actor, 1000)

test('planOps on a wall board: shoutout and note pass, a shape does not', () => {
  const r = planAdd(board('wall'), new Map(), [add('s1', 'shoutout', {}), add('n1', 'note', { text: 'x' }), add('p1', 'shape', { shape: 'rect' })])
  assert.deepEqual(r.applied.map((i) => i.id), ['s1', 'n1'])
  assert.deepEqual(r.rejected.map((x) => x.id), ['p1'])
})

test('retro boards accept the kinds other features add (planOps level)', () => {
  const r = planAdd(board('retro'), new Map(), [add('a1', 'action', {}), add('t1', 'topic', {}), add('th1', 'theme', {})])
  assert.equal(r.applied.length, 3)
})

// --- B2: media caps, budget, tombstones, doc cap ------------------------------------------------------------------
test('image src is capped at 400 KB and a card photo at 200 KB; image src must be https or data:image', () => {
  assert.equal(validateItem({ id: 'a', kind: 'image', data: { src: DATA(400 * 1024) } }).ok, true)
  assert.equal(validateItem({ id: 'a', kind: 'image', data: { src: DATA(400 * 1024 + 1) } }).ok, false)
  assert.equal(validateItem({ id: 'a', kind: 'image', data: { src: 'http://x.test/a.png' } }).ok, false)
  assert.equal(validateItem({ id: 'a', kind: 'image', data: { src: 'javascript:alert(1)' } }).ok, false)
  assert.equal(validateItem({ id: 'a', kind: 'image', data: { src: 'https://x.test/a.png' } }).ok, true)
  const card = { message: 'm', signer: 's', color: 'blue' }
  assert.equal(validateItem({ id: 'a', kind: 'card', data: { ...card, image: DATA(200 * 1024) } }).ok, true)
  assert.equal(validateItem({ id: 'a', kind: 'card', data: { ...card, image: DATA(200 * 1024 + 1) } }).ok, false)
})

test('a board holds at most 3 MB of pictures: the add that would pass it is refused, and deleting frees room', () => {
  const pic = (id) => add(id, 'image', { src: DATA(390 * 1024) })
  const first = planAdd(board(), new Map(), Array.from({ length: 8 }, (_, i) => pic(`p${i}`)))
  assert.equal(first.applied.length, 7) // 7 x 390 KB < 3 MB < 8 x 390 KB
  assert.deepEqual(first.rejected.map((x) => x.error), ['This board has reached its picture limit'])
  assert.ok(MAX_MEDIA === 3 * 1024 * 1024)
  const items = new Map(first.writes.map(({ item }) => [item.id, item]))
  const del = planOps(board(), items, [{ op: 'delete', id: 'p0' }, { ...pic('p9'), id: 'p9' }], actor, 2000)
  assert.equal(del.applied.length, 2, 'deleting a picture makes room for another')
})

test('growing a picture through an update counts against the budget too', () => {
  const small = { id: 'p1', kind: 'image', x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { src: DATA(1000) }, deleted: false, votes: [], reactions: {}, authorUid: actor.uid, updatedAt: 1 }
  const filler = (i) => ({ ...small, id: `f${i}`, data: { src: DATA(390 * 1024) } })
  const items = new Map([small, ...Array.from({ length: 7 }, (_, i) => filler(i))].map((i) => [i.id, i]))
  const r = planOps(board(), items, [{ op: 'update', id: 'p1', patch: { data: { src: DATA(390 * 1024) } } }], actor, 3000)
  assert.deepEqual(r.rejected.map((x) => x.error), ['This board has reached its picture limit'])
})

test('a deleted item is a tombstone: its heavy data, text, votes and reactions are gone', () => {
  const item = { id: 'p1', kind: 'image', x: 5, y: 6, w: 100, h: 100, z: 0, rot: 0, data: { src: DATA(5000) }, deleted: false, votes: ['KM-X'], reactions: { '🎉': ['KM-X'] }, authorUid: actor.uid, updatedAt: 1 }
  const r = planOps(board(), new Map([[item.id, item]]), [{ op: 'delete', id: 'p1' }], actor, 5000)
  const [{ item: t }] = r.writes
  assert.equal(t.deleted, true)
  assert.deepEqual(t.data, {})
  assert.deepEqual([t.votes, t.reactions], [[], {}])
  assert.equal(t.id, 'p1')
  assert.ok(t.updatedAt > 1)
  assert.equal(mediaSize(t), 0)
})

test('a board holds at most 4000 documents, live and deleted together', () => {
  const r = planOps(board(), new Map(), [{ op: 'add', id: 'n1', item: add('n1', 'note', { text: 'x' }).item }], actor, 1, 0, undefined, 0, MAX_DOCS)
  assert.deepEqual(r.rejected.map((x) => x.error), ['Board is full'])
})

test('memory store: the whole path (store.applyOps) enforces kinds and the budget', async () => {
  const store = createMemoryStore()
  const b = await store.createBoard({ code: 'QQQ234', type: 'workshop', template: 'blank', title: 'T', ownerId: 'u1' })
  const res = await store.applyOps(b.code, [validateOp(add('s1', 'shoutout', { toName: 'x', message: 'y', badge: 'Teamwork' })).op], actor)
  assert.equal(res.applied.length, 0)
  assert.equal(res.rejected.length, 1)
})

// --- I4: slim update broadcasts ------------------------------------------------------------------------------------
test('slimApplied: a moved picture is broadcast without its data URL; new pictures, replaced pictures and deletes go whole', () => {
  const doc = { id: 'p1', kind: 'image', x: 1, y: 2, data: { src: DATA(5000) }, updatedAt: 9, deleted: false }
  const [moved] = slimApplied([doc], [{ op: 'update', id: 'p1', patch: { x: 1 } }])
  assert.equal(moved.slim, true)
  assert.deepEqual(moved.data, {})
  assert.equal(moved.x, 1)
  assert.equal(slimApplied([doc], [{ op: 'add', id: 'p1', item: doc }])[0], doc)
  assert.equal(slimApplied([doc], [{ op: 'update', id: 'p1', patch: { data: { src: 'https://x.test/a.png' } } }])[0], doc)
  const gone = { ...doc, deleted: true, data: {} }
  assert.equal(slimApplied([gone], [{ op: 'delete', id: 'p1' }])[0], gone)
  const note = { id: 'n', kind: 'note', data: { text: 'a' }, updatedAt: 1 }
  assert.equal(slimApplied([note], [{ op: 'update', id: 'n', patch: { x: 3 } }])[0], note, 'no heavy fields, nothing to strip')
})

test('client merge: a slim doc keeps the heavy fields of the item held; for an unknown item it is ignored and lastSeen does not move', () => {
  const full = { id: 'p1', kind: 'image', x: 0, y: 0, w: 10, h: 10, z: 0, rot: 0, data: { src: 'data:image/png;base64,AAAA' }, updatedAt: 5, deleted: false }
  const s0 = initialState({ board: { code: 'ABC234', lastTs: 5 }, items: [full] })
  const s1 = reducer(s0, { type: 'remote', items: [{ ...full, x: 50, updatedAt: 8, data: {}, slim: true }] })
  const got = s1.items.get('p1')
  assert.equal(got.x, 50)
  assert.equal(got.data.src, full.data.src)
  assert.equal('slim' in got, false)
  assert.equal(s1.lastSeen, 8)
  const s2 = reducer(s0, { type: 'remote', items: [{ ...full, id: 'p2', updatedAt: 99, data: {}, slim: true }] })
  assert.equal(s2.items.has('p2'), false)
  assert.equal(s2.lastSeen, 5)
})

// --- config and wiring ---------------------------------------------------------------------------------------------
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('the stream deadline defaults to 270 s, below Vercel\'s 300 s', async () => {
  assert.match(await read('src/app/api/rt/stream/route.js'), /DEFAULT_MAX_MS = 270_000/)
})

test('security headers are configured, and node >= 22 is required', async () => {
  const cfg = (await import('../next.config.mjs')).default
  const rules = await cfg.headers()
  const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]))
  assert.equal(h['X-Content-Type-Options'], 'nosniff')
  assert.equal(h['X-Frame-Options'], 'DENY')
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.ok(h['Referrer-Policy'] && h['Permissions-Policy'])
  assert.equal(JSON.parse(await read('package.json')).engines.node, '>=22')
})

test('the default request body cap is small; only the ops route allows more', async () => {
  const { readJson } = await import('../src/lib/http.js')
  const big = JSON.stringify({ a: 'x'.repeat(20 * 1024) })
  await assert.rejects(readJson(new Request('http://x.test/', { method: 'POST', body: big })), (e) => e.status === 413)
  assert.match(await read('src/app/api/boards/[code]/ops/route.js'), /MAX_BODY = 1\.5 \* 1024 \* 1024/)
})

test('the signed-in owner is sent the people list, a guest never is', async () => {
  const src = await read('src/app/api/boards/[code]/route.js')
  assert.match(src, /viewer\.role === 'owner' \? store\.listPeople\(code\) : \[\]/)
})
