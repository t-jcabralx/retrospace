import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const tpl = await import('../src/app/api/templates/route.js')
const tplId = await import('../src/app/api/templates/[id]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

async function call(handler, method, path, { body, raw, cookie, ip = fakeIp(), headers = {}, params } = {}) {
  const h = { 'x-forwarded-for': ip, ...headers }
  if (body !== undefined || raw !== undefined) h['content-type'] ??= 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), params ? { params: Promise.resolve(params) } : undefined)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data }
}

async function signUp(name) {
  const res = await register(new Request('http://localhost:3100/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' }) }))
  assert.equal(res.status, 200)
  return res.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0]
}

const ann = await signUp('ann')
const bob = await signUp('bob')
const cols = [{ title: 'Keep', emoji: '🔥' }, { title: 'Drop' }, { title: 'Try', emoji: '' }]
const snapshot = async (code, cookie) => (await call(board.GET, 'GET', `/api/boards/${code}`, { cookie, params: { code } })).data

test('create-board: custom retro columns become the starter frames, flagged as columns; the header is editable', async () => {
  const r = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'retro', template: 'retro-ssc', title: 'T', columns: cols, header: 'Be kind.' } })
  assert.equal(r.status, 200)
  const items = (await snapshot(r.data.code, ann)).items
  const frames = items.filter((i) => i.kind === 'frame').sort((a, b) => a.x - b.x)
  assert.deepEqual(frames.map((f) => f.data), [{ title: '🔥 Keep', col: true }, { title: 'Drop', col: true }, { title: 'Try', col: true }])
  assert.equal(items.find((i) => i.kind === 'text').data.text, 'Be kind.')
})

test('create-board: without columns the built-in layout is kept; bad columns are a 400 and create nothing', async () => {
  const plain = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'retro', template: 'retro-msg', title: 'T' } })
  const frames = (await snapshot(plain.data.code, ann)).items.filter((i) => i.kind === 'frame')
  assert.deepEqual(frames.map((f) => f.data.title).sort(), ['Glad', 'Mad', 'Sad'])
  for (const columns of [[], 'x', Array.from({ length: 9 }, (_, i) => ({ title: `c${i}` })), [{ title: '' }], [{ title: 'a', emoji: 'ab' }]]) {
    const r = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'retro', template: 'retro-msg', title: 'T', columns } })
    assert.equal(r.status, 400, JSON.stringify(columns))
  }
})

test('create-board: workshop retro takes columns; a celebration ignores them', async () => {
  const w = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'workshop', template: 'retro', title: 'T', columns: [{ title: 'A' }, { title: 'B' }] } })
  assert.equal((await snapshot(w.data.code, ann)).items.filter((i) => i.kind === 'frame').length, 2)
  const c = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'celebration', template: 'birthday', title: 'T', recipient: { name: 'Sam' }, columns: [{ title: 'A' }] } })
  assert.equal(c.status, 200)
  assert.equal((await snapshot(c.data.code, ann)).items.filter((i) => i.kind === 'frame').length, 0)
})

const save = (cookie, extra = {}, opts = {}) => call(tpl.POST, 'POST', '/api/templates', { cookie, body: { name: `Mine ${rnd()}`, type: 'retro', columns: cols, ...extra }, ...opts })

test('templates: a session, JSON and same origin are required', async () => {
  assert.equal((await save(undefined)).status, 401)
  assert.equal((await call(tpl.GET, 'GET', '/api/templates', {})).status, 401)
  assert.equal((await call(tpl.POST, 'POST', '/api/templates', { cookie: ann, raw: '{}', headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await save(ann, {}, { headers: { origin: 'http://evil.example' } })).status, 403)
  assert.equal((await call(tplId.DELETE, 'DELETE', '/api/templates/tpl_0123456789abcdef', { cookie: ann, headers: { origin: 'http://evil.example' }, params: { id: 'tpl_0123456789abcdef' } })).status, 403)
  assert.equal((await call(tplId.DELETE, 'DELETE', '/api/templates/tpl_0123456789abcdef', { params: { id: 'tpl_0123456789abcdef' } })).status, 401)
})

test('templates: save, list (owner only, newest first, public fields only), delete', async () => {
  const carol = await signUp('carol')
  const a = await save(carol, { name: '  First   one ' })
  assert.equal(a.status, 200)
  assert.equal(a.data.template.name, 'First one')
  assert.deepEqual(Object.keys(a.data.template).sort(), ['columns', 'createdAt', 'id', 'name', 'type'])
  assert.deepEqual(a.data.template.columns, [{ title: 'Keep', emoji: '🔥' }, { title: 'Drop', emoji: '' }, { title: 'Try', emoji: '' }])
  await new Promise((r) => setTimeout(r, 3))
  const b = await save(carol, { name: 'Second' })
  const list = await call(tpl.GET, 'GET', '/api/templates', { cookie: carol })
  assert.deepEqual(list.data.templates.map((t) => t.name), ['Second', 'First one'])
  assert.deepEqual((await call(tpl.GET, 'GET', '/api/templates', { cookie: bob })).data.templates.filter((t) => t.name === 'Second'), [])
  const id = b.data.template.id
  assert.equal((await call(tplId.DELETE, 'DELETE', `/api/templates/${id}`, { cookie: bob, params: { id } })).status, 404, "someone else's template is a 404")
  assert.equal((await call(tplId.DELETE, 'DELETE', `/api/templates/${id}`, { cookie: carol, params: { id } })).status, 200)
  assert.equal((await call(tplId.DELETE, 'DELETE', `/api/templates/${id}`, { cookie: carol, params: { id } })).status, 404)
  assert.equal((await call(tplId.DELETE, 'DELETE', '/api/templates/nope', { cookie: carol, params: { id: 'nope' } })).status, 404)
  assert.equal((await call(tpl.GET, 'GET', '/api/templates', { cookie: carol })).data.templates.length, 1)
})

test('templates: name and columns are validated; a name is unique per account (case-insensitive) but not across accounts', async () => {
  const dave = await signUp('dave')
  for (const extra of [{ name: '' }, { name: 'x'.repeat(41) }, { name: 5 }, { type: 'wall' }, { type: undefined }, { columns: [] }, { columns: [{ title: '' }] }, { columns: [{ title: 'a', emoji: 'zz' }] }]) {
    assert.equal((await save(dave, extra)).status, 400, JSON.stringify(extra))
  }
  assert.equal((await save(dave, { name: 'Sprint' })).status, 200)
  assert.equal((await save(dave, { name: 'sprint' })).status, 409)
  assert.equal((await save(bob, { name: 'Sprint' })).status, 200)
})

test('templates: at most 30 per account', async () => {
  const { getStore } = await import('../src/lib/store.js')
  const res = await register(new Request('http://localhost:3100/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ email: `erin-${rnd()}@example.com`, name: 'erin', password: 'correct horse battery' }) }))
  const erinId = (await res.json()).user.id
  const erin = res.headers.getSetCookie().find((c) => c.startsWith('rs_session=')).split(';')[0]
  for (let i = 0; i < 30; i++) await getStore().createTemplate({ id: `tpl_${rnd()}${rnd()}${rnd()}`.slice(0, 20), ownerId: erinId, name: `T${i}`, type: 'retro', columns: [{ title: 'a', emoji: '' }], createdAt: i })
  const over = await save(erin, { name: 'one more' })
  assert.equal(over.status, 409)
  assert.match(over.data.error, /30/)
})

test('templates: 30 calls a minute per account, then 429', async () => {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 5_000) await new Promise((r) => setTimeout(r, left + 100))
  const fay = await signUp('fay')
  const statuses = []
  for (let i = 0; i < 31; i++) statuses.push((await call(tpl.GET, 'GET', '/api/templates', { cookie: fay })).status)
  assert.deepEqual([statuses[29], statuses[30]], [200, 429])
})

test('settings column ops through the ops route: rename, move, add, remove and use-as-column keep the flag and the rest', async () => {
  const { columnFrames, retitleOp, moveColumnOps, addColumnOp, removeColumnOps, freeColumnOp } = await import('../src/ui/columnOps.js')
  const r = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { type: 'retro', template: 'retro-ssc', title: 'T' } })
  const code = r.data.code
  const send = async (ops) => {
    const res = await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { cookie: ann, params: { code }, body: { ops } })
    assert.equal(res.status, 200, JSON.stringify(res.data))
    assert.equal(res.data.applied.length, ops.length)
    return (await snapshot(code, ann)).items
  }
  let items = (await snapshot(code, ann)).items
  assert.deepEqual(columnFrames(items).map((c) => c.data.title), ['Start', 'Stop', 'Continue'])
  items = await send([retitleOp(columnFrames(items)[0], { title: 'Begin', emoji: '🚀' })])
  assert.equal(columnFrames(items)[0].data.title, '🚀 Begin')
  items = await send(moveColumnOps(items, columnFrames(items)[0].id, 1))
  assert.deepEqual(columnFrames(items).map((c) => c.data.title), ['Stop', '🚀 Begin', 'Continue'])
  items = await send([addColumnOp(items, { title: 'Later' })])
  assert.deepEqual(columnFrames(items).map((c) => c.data.title), ['Stop', '🚀 Begin', 'Continue', 'Later'])
  items = await send(removeColumnOps(items, columnFrames(items)[1].id))
  assert.deepEqual(columnFrames(items).map((c) => c.data.title), ['Stop', 'Continue', 'Later'])
  items = await send([freeColumnOp(columnFrames(items)[2])])
  assert.equal(columnFrames(items).length, 2)
  assert.ok(items.some((i) => i.kind === 'frame' && i.data.title === 'Later' && !i.data.col))
})

test('create-board: votes per person (retro only, 1 to 20, default 3)', async () => {
  const votesOf = async (body) => {
    const r = await call(createBoard, 'POST', '/api/boards', { cookie: ann, body: { title: 'T', ...body } })
    return r.status === 200 ? (await snapshot(r.data.code, ann)).board.vote.perPerson : r.status
  }
  assert.equal(await votesOf({ type: 'retro', template: 'retro-ssc' }), 3)
  assert.equal(await votesOf({ type: 'retro', template: 'retro-ssc', votes: 7 }), 7)
  assert.equal(await votesOf({ type: 'retro', template: 'retro-ssc', votes: 20 }), 20)
  for (const votes of [0, 21, 2.5, '3', null]) assert.equal(await votesOf({ type: 'retro', template: 'retro-ssc', votes }), 400, String(votes))
  assert.equal(await votesOf({ type: 'workshop', template: 'retro', votes: 9 }), 3, 'ignored outside retro boards')
})
