import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Route handlers go through getStore(); force the in-memory store and no Redis whatever the shell has set.
for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { PUT: personaRoute } = await import('../src/app/api/boards/[code]/persona/route.js')
const { POST: rtJoin } = await import('../src/app/api/rt/join/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')
const { POST: logout } = await import('../src/app/api/auth/logout/route.js')
const { generatePersona, avatarFromSeed, ADJECTIVES, ANIMALS } = await import('../src/lib/persona.js')
const { verifyTok } = await import('../src/lib/rt.js')
const { publicId, publicIdForUser } = await import('../src/lib/guest.js')
const { getStore } = await import('../src/lib/store.js')
const { windowCount } = await import('../src/lib/http.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const bodies = []
const rawUids = new Set() // the PRIVATE cookie uids handed out: none may ever show up in a response body
const rawOf = (rsg) => rsg.split(';')[0].slice('rs_g='.length).split('.')[0]

async function call(handler, method, path, { body, raw, cookie, code, headers = {} } = {}) {
  const h = { 'x-forwarded-for': fakeIp(), ...headers }
  if (body !== undefined || raw !== undefined) h['content-type'] ??= 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), code ? { params: Promise.resolve({ code }) } : undefined)
  const text = await res.text()
  bodies.push(text)
  for (const c of res.headers.getSetCookie()) if (c.startsWith('rs_g=')) rawUids.add(rawOf(c))
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data, res, setCookies: res.headers.getSetCookie() }
}

async function signUp(name) {
  const email = `${name.toLowerCase().replace(/\s/g, '')}-${rnd()}@example.com`
  const r = await call(register, 'POST', '/api/auth/register', { body: { email, name, password: 'correct horse battery' } })
  assert.equal(r.status, 200)
  return { id: r.data.user.id, email, name, cookie: r.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0] }
}

const guestSnapshots = []
const snapshot = async (code, cookie) => {
  const r = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie })
  if (r.data.viewer?.role === 'guest') guestSnapshots.push(JSON.stringify(r.data))
  return r
}
const putPersona = (code, cookie, persona, extra = {}) => call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie, body: { persona, ...extra } })
const ops = (code, cookie, list, extra = {}) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: list, ...extra } })
const note = (id, text = 'hi') => ({ op: 'add', item: { id, kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text } } })
const anon = (taken) => generatePersona(Math.random, taken)
const custom = (name, avatar = AV) => ({ kind: 'custom', name, avatar })

// A browser: opens the snapshot (minting rs_g) and returns its cookie header plus the uid.
async function browser(code, extraCookie) {
  const snap = await snapshot(code, extraCookie)
  const rsg = snap.setCookies.find((c) => c.startsWith('rs_g='))
  assert.ok(rsg)
  return { cookie: [extraCookie, rsg.split(';')[0]].filter(Boolean).join('; '), uid: snap.data.viewer.uid, raw: rawOf(rsg), rsg: rsg.split(';')[0] }
}
async function guest(code, name) {
  const b = await browser(code)
  const r = await putPersona(code, b.cookie, name ? custom(name) : anon())
  assert.equal(r.status, 200)
  return { ...b, persona: r.data.persona }
}

const ann = await signUp('Dana Facilitator')
const made = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T' } })
const CODE = made.data.code
const newBoard = async (extra = {}) => (await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'blank', title: 'T', ...extra } })).data.code

test('the snapshot mints the signed rs_g cookie once, and returns the viewer uid with no persona yet', async () => {
  const first = await snapshot(CODE)
  const set = first.setCookies.find((c) => c.startsWith('rs_g='))
  assert.ok(set)
  for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000']) assert.ok(set.includes(attr), attr)
  assert.match(first.data.viewer.uid, /^KM-/)
  const raw = rawOf(set)
  assert.equal(first.data.viewer.uid, publicId(CODE, raw), 'viewer.uid is this board\'s public id for the cookie')
  assert.notEqual(first.data.viewer.uid, raw, 'and never the private cookie uid')
  assert.equal(first.data.viewer.persona, null)
  assert.deepEqual(first.data.participants.filter((p) => p.uid === first.data.viewer.uid), [])
  const again = await snapshot(CODE, set.split(';')[0])
  assert.equal(again.setCookies.some((c) => c.startsWith('rs_g=')), false, 'a valid cookie is not re-minted')
  assert.equal(again.data.viewer.uid, first.data.viewer.uid)
  const forged = await snapshot(CODE, `rs_g=${raw}.${'0'.repeat(32)}`)
  assert.ok(forged.setCookies.some((c) => c.startsWith('rs_g=')), 'a forged cookie is replaced')
  assert.notEqual(forged.data.viewer.uid, first.data.viewer.uid)
})

test('PUT persona creates the persona; the snapshot then shows it as viewer.persona and in participants', async () => {
  const code = await newBoard()
  const b = await browser(code)
  const p = anon()
  const put = await putPersona(code, b.cookie, p)
  assert.equal(put.status, 200)
  assert.deepEqual(put.data, { persona: { kind: 'anonymous', name: p.name, avatar: p.avatar } })
  const snap = await snapshot(code, b.cookie)
  assert.deepEqual(snap.data.viewer.persona, put.data.persona)
  const mine = snap.data.participants.find((x) => x.uid === b.uid)
  assert.deepEqual(mine, { uid: b.uid, name: p.name, avatar: p.avatar, kind: 'anonymous' })
  assert.ok(snap.data.participants.every((x) => Object.keys(x).sort().join() === 'avatar,kind,name,uid'))
})

test('PUT persona needs the guest cookie: none, forged or from another secret is 401 "Join the board first"; a body uid is ignored', async () => {
  const code = await newBoard()
  const victim = await guest(code)
  const none = await putPersona(code, undefined, anon())
  assert.deepEqual([none.status, none.data.error], [401, 'Join the board first'])
  const forged = await putPersona(code, `rs_g=${victim.raw}.${'a'.repeat(32)}`, anon())
  assert.deepEqual([forged.status, forged.data.error], [401, 'Join the board first'])
  const b = await browser(code)
  const mine = anon()
  const r = await putPersona(code, b.cookie, mine, { uid: victim.uid })
  assert.equal(r.status, 200)
  const snap = await snapshot(code, victim.cookie)
  assert.equal(snap.data.participants.find((x) => x.uid === victim.uid).name, victim.persona.name, 'the victim\'s persona is untouched')
  assert.equal(snap.data.participants.find((x) => x.uid === b.uid).name, mine.name)
})

test('PUT persona validation: free text posing as anonymous 400, case-only duplicate 409, owner\'s name 409, no letter 400', async () => {
  const code = await newBoard()
  const first = await guest(code, 'Ana Maria')
  const b = await browser(code)
  const put = (persona) => putPersona(code, b.cookie, persona)
  const smuggled = await put({ kind: 'anonymous', name: 'Call me on 555-0100', avatar: AV })
  assert.equal(smuggled.status, 400)
  const dup = await put(custom('ANA MARIA'))
  assert.deepEqual([dup.status, dup.data.error], [409, 'That name is already taken on this board'])
  assert.equal((await put(custom('ana  maria'))).status, 409)
  const ownerName = await put(custom('dana facilitator'))
  assert.equal(ownerName.status, 409)
  assert.equal((await put(custom('🎉🎉'))).status, 400)
  assert.equal((await put({ kind: 'custom', name: 'Zed', avatar: { ...AV, bg: 40 } })).status, 400)
  assert.equal((await put({ kind: 'account', name: 'Dana Facilitator', avatar: AV })).status, 400, 'only the owner may use the account kind')
  assert.equal((await put({ kind: 'custom', name: 'Zed' })).status, 400)
  const anonTaken = await put({ kind: 'anonymous', name: first.persona.name, avatar: AV })
  assert.equal(anonTaken.status, 400) // a custom name is not a generated one
  const gen = anon()
  assert.equal((await putPersona(code, (await browser(code)).cookie, gen)).status, 200)
  const dupGen = await put({ kind: 'anonymous', name: gen.name, avatar: AV })
  assert.equal(dupGen.status, 409)
  assert.equal(typeof dupGen.data.suggestion, 'string')
  assert.notEqual(dupGen.data.suggestion.toLowerCase(), gen.name.toLowerCase())
  assert.equal((await put({ kind: 'anonymous', name: dupGen.data.suggestion, avatar: AV })).status, 200, 'the suggestion can be adopted')
})

test('two guests racing for the same custom name: exactly one wins, the other gets 409', async () => {
  const code = await newBoard()
  const a = await browser(code)
  const b = await browser(code)
  const [ra, rb] = await Promise.all([putPersona(code, a.cookie, custom('Racer')), putPersona(code, b.cookie, custom('racer'))])
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409])
})

test('a persona can change until the participant has authored something, then it is fixed (403)', async () => {
  const code = await newBoard()
  const g = await guest(code)
  const other = await guest(code)
  assert.equal((await putPersona(code, g.cookie, custom('Gus One'))).status, 200)
  assert.equal((await putPersona(code, g.cookie, custom('Gus Two'))).status, 200)
  assert.equal((await ops(code, g.cookie, [note('n1')])).data.applied.length, 1)
  const locked = await putPersona(code, g.cookie, custom('Gus Three'))
  assert.deepEqual([locked.status, locked.data.error], [403, 'Persona is fixed once you have added something'])
  assert.equal((await putPersona(code, g.cookie, anon())).status, 403)
  assert.equal((await snapshot(code, g.cookie)).data.viewer.persona.name, 'Gus Two')
  assert.equal((await putPersona(code, other.cookie, custom('Other Two'))).status, 200, 'others are unaffected')
})

test('persona changes are limited to 10 an hour per guest uid; another guest has its own budget', async () => {
  const hourLeft = 3600_000 - (Date.now() % 3600_000)
  if (hourLeft < 10_000) await new Promise((r) => setTimeout(r, hourLeft + 200))
  const code = await newBoard()
  const g = await browser(code)
  for (let i = 0; i < 10; i++) assert.equal((await putPersona(code, g.cookie, custom(`Name ${rnd()}`))).status, 200, `change ${i + 1}`)
  const blocked = await putPersona(code, g.cookie, custom('One Too Many'))
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0)
  assert.equal((await putPersona(code, (await browser(code)).cookie, custom(`Fresh ${rnd()}`))).status, 200)
})

test('closed boards: a new guest cannot set a persona (403) but can read; the owner still can; revoked and passcode boards refuse as usual', async () => {
  const code = await newBoard()
  const early = await guest(code)
  const owner = await browser(code, ann.cookie)
  const patch = (p) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: p } })
  assert.equal((await patch({ status: 'closed' })).status, 200)
  const b = await browser(code)
  const r = await putPersona(code, b.cookie, anon())
  assert.deepEqual([r.status, r.data.error], [403, 'Board is closed'])
  assert.equal((await putPersona(code, early.cookie, custom('Changed Mind'))).status, 403, 'nothing changes on a closed board for guests')
  assert.equal((await snapshot(code, b.cookie)).status, 200)
  assert.equal((await putPersona(code, owner.cookie, { kind: 'account', name: 'x', avatar: AV })).status, 200)
  assert.equal((await patch({ status: 'open', revoked: true })).status, 200)
  assert.equal((await putPersona(code, b.cookie, anon())).data.error, 'This link was revoked')
  assert.equal((await patch({ revoked: false, passcode: 'open sesame' })).status, 200)
  const pc = await putPersona(code, b.cookie, anon())
  assert.deepEqual([pc.status, pc.data.error], [401, 'Passcode required'])
})

test('PUT persona is JSON-only and same-origin', async () => {
  const code = await newBoard()
  const b = await browser(code)
  const text = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: b.cookie, raw: '{}', headers: { 'content-type': 'text/plain' } })
  assert.equal(text.status, 415)
  const foreign = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: b.cookie, body: { persona: anon() }, headers: { origin: 'http://evil.example' } })
  assert.equal(foreign.status, 403)
  assert.equal((await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: b.cookie, raw: '[]' })).status, 400)
  assert.equal((await call(personaRoute, 'PUT', `/api/boards/ZZZZZZ/persona`, { code: 'ZZZZZZ', cookie: b.cookie, body: { persona: anon() } })).status, 404)
})

test('ops without a valid guest cookie is 401 "Join the board first"; with the cookie but no persona it is 409 "Choose a name first"', async () => {
  const code = await newBoard()
  const g = await guest(code)
  const none = await ops(code, undefined, [note('a')])
  assert.deepEqual([none.status, none.data.error], [401, 'Join the board first'])
  const forged = await ops(code, `rs_g=${g.raw}.${'0'.repeat(32)}`, [note('a')], { uid: g.uid, name: 'x' })
  assert.deepEqual([forged.status, forged.data.error], [401, 'Join the board first'])
  const sansMac = await ops(code, `rs_g=${g.raw}`, [note('a')], { uid: g.uid })
  assert.equal(sansMac.status, 401)
  const old = await ops(code, `km_uid=${g.raw}`, [note('a')], { uid: g.uid })
  assert.equal(old.status, 401, 'the old client-set cookie proves nothing')
  const fresh = await browser(code)
  const nameless = await ops(code, fresh.cookie, [note('a')], { uid: fresh.uid, name: 'I am Mallory' })
  assert.deepEqual([nameless.status, nameless.data.error], [409, 'Choose a name first'])
  assert.equal((await snapshot(code, g.cookie)).data.items.some((i) => i.id === 'a'), false)
})

test('ops ignores uid, name and avatar in the body: the item carries the cookie uid and the stored persona', async () => {
  const code = await newBoard()
  const a = await guest(code, 'Real Alice')
  const b = await guest(code, 'Real Bob')
  const r = await ops(code, a.cookie, [note('n1')], { uid: b.uid, name: 'Mallory', avatar: { bg: 0, body: 0, eyes: 0, mouth: 0, extra: 0 } })
  assert.equal(r.status, 200)
  const [item] = r.data.applied
  assert.equal(item.authorUid, a.uid)
  assert.equal(item.authorName, 'Real Alice')
  assert.deepEqual(item.authorAvatar, AV)
  const withAuthor = await ops(code, a.cookie, [{ op: 'add', item: { id: 'n2', kind: 'note', data: { text: 'x' }, authorUid: b.uid, authorName: 'Evil', authorAvatar: {} } }])
  assert.deepEqual([withAuthor.data.applied[0].authorUid, withAuthor.data.applied[0].authorName], [a.uid, 'Real Alice'])
  const stored = (await snapshot(code, a.cookie)).data.items.find((i) => i.id === 'n1')
  assert.deepEqual([stored.authorUid, stored.authorName, stored.authorAvatar], [a.uid, 'Real Alice', AV])
})

test('guest A cannot update or delete guest B\'s items, even when the body (or query) claims B\'s uid', async () => {
  const code = await newBoard()
  const a = await guest(code)
  const b = await guest(code)
  assert.equal((await ops(code, b.cookie, [note('bnote', 'bob')])).data.applied.length, 1)
  const claimB = { uid: b.uid, name: b.persona.name }
  const upd = await ops(code, a.cookie, [{ op: 'update', id: 'bnote', patch: { data: { text: 'hacked' } } }], claimB)
  assert.deepEqual(upd.data.rejected.map((x) => x.error), ['Not allowed'])
  assert.equal(upd.data.applied.length, 0)
  const del = await ops(code, a.cookie, [{ op: 'delete', id: 'bnote' }], claimB)
  assert.deepEqual(del.data.rejected.map((x) => x.error), ['Not allowed'])
  const viaQuery = await call(opsRoute, 'POST', `/api/boards/${code}/ops?uid=${b.uid}`, { code, cookie: a.cookie, body: { ops: [{ op: 'delete', id: 'bnote' }], uid: b.uid } })
  assert.deepEqual(viaQuery.data.rejected.map((x) => x.error), ['Not allowed'])
  const item = (await snapshot(code, b.cookie)).data.items.find((i) => i.id === 'bnote')
  assert.equal(item.data.text, 'bob')
  // B's uid with A's mac (a spliced cookie), or B's uid alone, is no identity at all
  const spliced = `rs_g=${b.raw}.${a.rsg.split('.')[1]}`
  assert.equal((await ops(code, spliced, [{ op: 'delete', id: 'bnote' }], claimB)).status, 401)
  assert.equal((await ops(code, undefined, [{ op: 'delete', id: 'bnote' }], claimB)).status, 401)
  // the real owner of the note can still edit it
  const ok = await ops(code, b.cookie, [{ op: 'update', id: 'bnote', patch: { data: { text: 'edited' } } }])
  assert.equal(ok.data.applied.length, 1)
})

test('votes and reactions are recorded under the cookie uid, so one guest cannot vote as another', async () => {
  const code = await newBoard()
  await getStore().updateBoard(code, { vote: { active: true, perPerson: 3 } }) // votes are refused while voting is closed
  const a = await guest(code)
  const b = await guest(code)
  await ops(code, a.cookie, [note('v1')])
  const r = await ops(code, b.cookie, [{ op: 'vote', id: 'v1' }], { uid: a.uid })
  assert.deepEqual(r.data.applied[0].votes, [b.uid])
})

test('the owner gets an account persona on the first snapshot, authors under it, and may change the avatar after authoring', async () => {
  const code = await newBoard()
  const o = await browser(code, ann.cookie)
  const snap = await snapshot(code, o.cookie)
  assert.equal(snap.data.viewer.role, 'owner')
  assert.deepEqual(snap.data.viewer.persona, { kind: 'account', name: 'Dana Facilitator', avatar: avatarFromSeed(ann.id) })
  assert.equal(ann.id in Object.fromEntries(snap.data.participants.map((p) => [p.uid, 1])), false)
  const r = await ops(code, o.cookie, [note('o1')])
  assert.deepEqual([r.data.applied[0].authorUid, r.data.applied[0].authorName], [o.uid, 'Dana Facilitator'])
  const newAvatar = { bg: 7, body: 6, eyes: 5, mouth: 4, extra: 3 }
  const change = await putPersona(code, o.cookie, { kind: 'account', name: 'ignored', avatar: newAvatar })
  assert.deepEqual(change.data.persona, { kind: 'account', name: 'Dana Facilitator', avatar: newAvatar })
  const asCustom = await putPersona(code, o.cookie, custom('Facilitator Dee'))
  assert.equal(asCustom.status, 200)
})

test('the owner is the same participant on every browser: the id comes from the account, one account row, one name', async () => {
  const code = await newBoard({ template: 'retro' })
  const laptop = await browser(code, ann.cookie)
  const phone = await browser(code, ann.cookie)
  assert.notEqual(laptop.raw, phone.raw, 'two browsers, two private cookie uids')
  assert.equal(laptop.uid, phone.uid)
  assert.equal(laptop.uid, publicIdForUser(code, ann.id))
  const snap = await snapshot(code, phone.cookie)
  assert.equal(snap.data.participants.filter((p) => p.name === 'Dana Facilitator').length, 1)
  const a = await ops(code, laptop.cookie, [note('from-laptop')])
  const b = await ops(code, phone.cookie, [note('from-phone')])
  assert.deepEqual([a.data.applied[0].authorUid, b.data.applied[0].authorUid], [laptop.uid, laptop.uid])
  const starters = (await snapshot(code, laptop.cookie)).data.items.filter((i) => i.id.startsWith('starter') || i.kind === 'frame')
  assert.ok(starters.length > 0 && starters.every((i) => i.authorUid === laptop.uid), 'the starter items belong to the same id')
  const starter = starters[0]
  for (const [who, jar] of [['laptop', laptop], ['phone', phone]]) {
    const upd = await ops(code, jar.cookie, [{ op: 'update', id: starter.id, patch: { x: who === 'laptop' ? 11 : 22 } }])
    assert.equal(upd.data.applied.length, 1, `the owner can update their starter item from the ${who}`)
    assert.equal(upd.data.applied[0].authorUid, laptop.uid)
  }
  // no cookie at all is needed: the session alone identifies the owner
  const sessionOnly = await ops(code, ann.cookie, [note('session-only')])
  assert.equal(sessionOnly.data.applied[0].authorUid, laptop.uid)
  assert.equal((await putPersona(code, (await browser(code)).cookie, custom('DANA FACILITATOR'))).status, 409)
})

test('after the owner signs out, the next person on that browser is a guest: no persona, no way to act as the owner', async () => {
  const code = await newBoard({ template: 'retro' })
  await getStore().updateBoard(code, { vote: { active: true, perPerson: 3 } })
  const owner = await browser(code, ann.cookie)
  await ops(code, owner.cookie, [note('owner-note', 'mine')])
  const ownerId = owner.uid
  // the same browser, session gone (what /api/auth/logout leaves: the rs_g cookie stays)
  const next = owner.rsg
  const snap = await snapshot(code, next)
  assert.deepEqual([snap.data.viewer.role, snap.data.viewer.persona], ['guest', null], 'the chooser appears')
  assert.notEqual(snap.data.viewer.uid, ownerId)
  assert.equal(snap.data.viewer.uid, publicId(code, owner.raw))
  assert.equal((await ops(code, next, [note('x')])).status, 409)
  assert.equal((await putPersona(code, next, { kind: 'account', name: 'Dana Facilitator', avatar: AV })).status, 400)
  assert.equal((await putPersona(code, next, custom('Dana Facilitator'))).status, 409, 'nor can they take the owner\'s name')
  assert.equal((await putPersona(code, next, anon())).status, 200)
  const upd = await ops(code, next, [{ op: 'update', id: 'owner-note', patch: { data: { text: 'taken over' } } }, { op: 'delete', id: 'owner-note' }], { uid: ownerId, name: 'Dana Facilitator' })
  assert.deepEqual(upd.data.rejected.map((r) => r.error), ['Not allowed', 'Not allowed'])
  const vote = await ops(code, next, [{ op: 'vote', id: 'owner-note' }], { uid: ownerId })
  assert.deepEqual(vote.data.applied[0].votes, [snap.data.viewer.uid], 'a vote lands under the guest\'s own id, not the owner\'s')
  assert.equal((await snapshot(code, ann.cookie)).data.items.find((i) => i.id === 'owner-note').data.text, 'mine')
})

test('a signed-in non-owner is just a guest: they choose a persona, and the account name is not special', async () => {
  const code = await newBoard()
  const bob = await signUp('Bob Account')
  const b = await browser(code, bob.cookie)
  const snap = await snapshot(code, b.cookie)
  assert.deepEqual([snap.data.viewer.role, snap.data.viewer.persona], ['guest', null])
  assert.equal((await ops(code, b.cookie, [note('x')])).status, 409)
  assert.equal((await putPersona(code, b.cookie, { kind: 'account', name: 'Bob Account', avatar: AV })).status, 400)
  assert.equal((await putPersona(code, b.cookie, anon())).status, 200)
})

test('rt/join issues the token for the cookie uid only, needs the cookie and a persona, and ignores a body uid', async () => {
  const code = await newBoard()
  const g = await guest(code)
  const victim = await guest(code)
  const join = (cookie, body = {}) => call(rtJoin, 'POST', '/api/rt/join', { cookie, body: { code, ...body } })
  const none = await join(undefined, { uid: victim.uid })
  assert.deepEqual([none.status, none.data.error], [401, 'Join the board first'])
  assert.equal((await join(`rs_g=${victim.raw}.${'1'.repeat(32)}`, { uid: victim.uid })).status, 401)
  const fresh = await browser(code)
  assert.deepEqual([(await join(fresh.cookie)).status, (await join(fresh.cookie)).data.error], [409, 'Choose a name first'])
  const ok = await join(g.cookie, { uid: victim.uid })
  assert.equal(ok.status, 200)
  assert.equal(verifyTok(code, g.uid, ok.data.tok), true)
  assert.equal(verifyTok(code, victim.uid, ok.data.tok), false, 'a token for the victim cannot be obtained by naming them')
  const owner = await browser(code, ann.cookie)
  assert.equal((await join(owner.cookie)).status, 200, 'the owner gets an account persona on demand')
})

test('creating a board authors the starter items as the owner\'s account id on that board, with no guest cookie involved', async () => {
  const made = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'retro', title: 'R', uid: 'KM-2222-2222-2222', name: 'Mallory' } })
  assert.equal(made.status, 200)
  assert.equal(made.setCookies.some((c) => c.startsWith('rs_g=')), false)
  const code = made.data.code
  const snap = await snapshot(code, ann.cookie)
  assert.equal(snap.data.viewer.uid, publicIdForUser(code, ann.id))
  assert.ok(snap.data.items.length > 0)
  for (const it of snap.data.items) {
    assert.equal(it.authorUid, publicIdForUser(code, ann.id))
    assert.equal(it.authorName, 'Dana Facilitator')
    assert.deepEqual(it.authorAvatar, avatarFromSeed(ann.id))
  }
  assert.ok(snap.data.participants.some((p) => p.kind === 'account' && p.name === 'Dana Facilitator'), 'the owner\'s name is claimed at creation')
  const other = await call(createBoard, 'POST', '/api/boards', { cookie: ann.cookie, body: { type: 'workshop', template: 'retro', title: 'R2' } })
  const otherSnap = await snapshot(other.data.code, ann.cookie)
  assert.notEqual(otherSnap.data.viewer.uid, snap.data.viewer.uid, 'a different board gives the owner a different id')
})

test('a snapshot never exposes emails, user ids, password or passcode hashes to a guest', async () => {
  const code = await newBoard()
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, body: { patch: { passcode: 'open sesame' } } })
  await browser(code, ann.cookie) // the owner's account persona is now in the participants list
  const { POST: joinRoute } = await import('../src/app/api/boards/[code]/join/route.js')
  const joined = await call(joinRoute, 'POST', `/api/boards/${code}/join`, { code, body: { passcode: 'open sesame' } })
  const access = joined.setCookies.find((c) => c.startsWith('rs_a_')).split(';')[0]
  const b = await browser(code, access)
  await putPersona(code, b.cookie, anon())
  await ops(code, b.cookie, [note('p1')])
  const snap = await snapshot(code, b.cookie)
  assert.equal(snap.status, 200)
  const raw = JSON.stringify(snap.data)
  for (const needle of [ann.email, ann.id, 'passwordHash', 'passcodeHash', 'scrypt$', 'ownerId', 'createdBy', 'tokenHash', 'open sesame']) assert.ok(!raw.includes(needle), `${needle} leaked into the snapshot`)
  assert.ok(snap.data.participants.length >= 2)
  assert.ok(guestSnapshots.length > 10)
  for (const text of guestSnapshots) for (const needle of [ann.email, ann.id, 'passwordHash', 'passcodeHash', 'ownerId']) assert.ok(!text.includes(needle), `${needle} in a guest snapshot`)
})

test('a generated persona round-trips through the route for every word pair shape (suffix included)', async () => {
  const code = await newBoard()
  const g = await browser(code)
  const name = `${ADJECTIVES[0]} ${ANIMALS[0]} 7`
  const r = await putPersona(code, g.cookie, { kind: 'anonymous', name, avatar: AV })
  assert.equal(r.status, 200)
  assert.equal(r.data.persona.name, name)
})

test('the same browser has unrelated ids on different boards, stable per board; ids from one board do nothing on another', async () => {
  const c1 = await newBoard()
  const c2 = await newBoard()
  const g = await browser(c1)
  const on2 = await snapshot(c2, g.rsg)
  assert.equal(g.uid, publicId(c1, g.raw))
  assert.equal(on2.data.viewer.uid, publicId(c2, g.raw))
  assert.notEqual(on2.data.viewer.uid, g.uid, 'nothing links the two boards')
  assert.equal((await snapshot(c1, g.rsg)).data.viewer.uid, g.uid, 'stable per (cookie, board)')
  // a persona on board 1 does not exist on board 2, and naming board 1's id gets nothing
  assert.equal((await putPersona(c1, g.cookie, custom('Board One Me'))).status, 200)
  assert.deepEqual([on2.data.viewer.persona], [null])
  const claim = await ops(c2, g.rsg, [note('x')], { uid: g.uid, name: 'Board One Me' })
  assert.deepEqual([claim.status, claim.data.error], [409, 'Choose a name first'])
  assert.equal((await putPersona(c2, g.rsg, custom('Board Two Me'))).status, 200)
  const w1 = await ops(c1, g.rsg, [note('n1', 'one')])
  assert.equal(w1.data.applied[0].authorUid, g.uid)
  const w2 = await ops(c2, g.rsg, [note('n2', 'two')])
  assert.equal(w2.data.applied[0].authorUid, on2.data.viewer.uid)
  // another browser cannot be A on either board; A's id from board 1 is not even a valid actor on board 2
  const tok1 = (await call(rtJoin, 'POST', '/api/rt/join', { cookie: g.rsg, body: { code: c1 } })).data.tok
  assert.equal(verifyTok(c1, g.uid, tok1), true)
  assert.equal(verifyTok(c2, g.uid, tok1), false)
  assert.equal(verifyTok(c1, g.raw, tok1), false, 'the token never binds the private uid')
  // every id in a snapshot is a board-specific one
  const snap2 = await snapshot(c2, g.rsg)
  assert.ok(snap2.data.items.every((i) => i.authorUid !== g.uid))
  assert.ok(snap2.data.participants.every((p) => p.uid !== g.uid))
})

test('a board holds 300 participants besides the owner: the 301st is refused, existing ones keep working, the snapshot stays bounded', async () => {
  const code = await newBoard()
  const store = getStore()
  const early = await guest(code, 'Early Bird')
  const joined = async () => (await store.listParticipants(code)).filter((p) => p.kind !== 'account').length
  for (let i = 0, have = await joined(); have + i < 300; i++) await store.joinParticipant(code, `KM-F${String(i).padStart(3, '0')}-2222-2222`, { kind: 'custom', name: `Filler ${i}`, avatar: AV })
  assert.equal(await joined(), 300, 'exactly 300 people besides the owner fit')
  assert.equal((await store.listParticipants(code)).length, 301, 'the owner\'s account row is not counted against them')
  const late = await browser(code)
  const refused = await putPersona(code, late.cookie, custom('Number 301'))
  assert.deepEqual([refused.status, refused.data.error], [403, 'This board is full'])
  assert.equal((await putPersona(code, early.cookie, custom('Early Bird 2'))).status, 200, 'someone already on the board may still change theirs')
  assert.equal((await ops(code, early.cookie, [note('still-works')])).status, 200)
  assert.equal((await snapshot(code, ann.cookie)).data.participants.length, 301)
  for (let i = 0; i < 5; i++) await store.joinParticipant(code, `KM-O${String(i).padStart(3, '0')}-2222-2222`, { kind: 'custom', name: `Overflow ${i}`, avatar: AV })
  const snap = await snapshot(code, late.cookie)
  assert.equal(snap.data.participants.length, 301, 'the list is capped even if a race overshot the limit')
  assert.equal(snap.data.viewer.persona, null)
})

test('the 299th-person off-by-one is gone: with the owner present, 299 guests plus one more still join', async () => {
  const code = await newBoard()
  const store = getStore()
  for (let i = 0; i < 299; i++) await store.joinParticipant(code, `KM-G${String(i).padStart(3, '0')}-2222-2222`, { kind: 'custom', name: `Guest ${i}`, avatar: AV })
  assert.equal((await putPersona(code, (await browser(code)).cookie, custom('The 300th'))).status, 200)
  assert.equal((await putPersona(code, (await browser(code)).cookie, custom('The 301st'))).status, 403)
})

test('a failed creation gives its slot in the per-board minute budget back (a lost name race does not use it up)', async () => {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 5_000) await new Promise((r) => setTimeout(r, left + 100))
  const code = await newBoard()
  const store = getStore()
  const used = () => windowCount(`pnew:${code}`, 60_000, { localFallback: true })
  assert.equal(await used(), 0)
  const real = store.joinParticipant
  store.joinParticipant = async () => { throw Object.assign(new Error('dup'), { code: 11000 }) } // the name was taken under our feet
  try {
    const lost = await putPersona(code, (await browser(code)).cookie, custom('Racer One'))
    assert.equal(lost.status, 409)
  } finally {
    store.joinParticipant = real
  }
  assert.equal(await used(), 0, 'the slot was refunded')
  assert.equal((await putPersona(code, (await browser(code)).cookie, custom('Racer Two'))).status, 200)
  assert.equal(await used(), 1, 'a created row keeps its slot')
  // a refused (invalid or full) request never takes one in the first place
  assert.equal((await putPersona(code, (await browser(code)).cookie, custom('!!'))).status, 400)
  assert.equal(await used(), 1)
})

test('the persona body is capped at 4 KB (413) and a huge name is a quick 400', async () => {
  const code = await newBoard()
  const b = await browser(code)
  const big = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: b.cookie, raw: JSON.stringify({ persona: custom('x'.repeat(5000)) }) })
  assert.equal(big.status, 413)
  const declared = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: b.cookie, raw: '{}', headers: { 'content-length': '999999' } })
  assert.equal(declared.status, 413, 'a declared size over the cap is refused without reading the body')
  const t = Date.now()
  const long = await putPersona(code, b.cookie, custom('x'.repeat(300)))
  assert.equal(long.status, 400)
  assert.ok(Date.now() - t < 500)
  assert.equal((await putPersona(code, b.cookie, custom('Small Enough'))).status, 200)
})

test('a guest over their hourly persona budget does not use up the board\'s new-person slots', async () => {
  const left = 60_000 - (Date.now() % 60_000)
  const hourLeft = 3600_000 - (Date.now() % 3600_000)
  if (left < 5_000) await new Promise((r) => setTimeout(r, left + 100))
  if (hourLeft < 10_000) await new Promise((r) => setTimeout(r, hourLeft + 200))
  const code = await newBoard()
  const store = getStore()
  const used = () => windowCount(`pnew:${code}`, 60_000, { localFallback: true })
  // 10 writes as an existing participant use the hourly budget; the 11th is refused
  const g = await browser(code)
  assert.equal((await putPersona(code, g.cookie, custom('Budget Zero'))).status, 200)
  for (let i = 1; i < 10; i++) assert.equal((await putPersona(code, g.cookie, custom(`Budget ${i}`))).status, 200)
  assert.equal(await used(), 1)
  assert.equal((await putPersona(code, g.cookie, custom('Budget Over'))).status, 429)
  assert.equal(await used(), 1, 'an update takes no slot')
  // a brand-new participant whose uid is already over budget: refused, and the slot comes back
  const burned = await browser(code)
  const key = `persona:${publicId(code, burned.raw)}`
  const { windowHit } = await import('../src/lib/http.js')
  for (let i = 0; i < 10; i++) await windowHit(key, 3600_000, { localFallback: true })
  const before = await used()
  const r = await putPersona(code, burned.cookie, custom('Burned Budget'))
  assert.equal(r.status, 429)
  assert.equal(await used(), before, 'the refused creation gave its slot back')
  assert.equal(await store.getParticipant(code, burned.uid), null)
})

test('new participants are admitted 100 a minute per board, from any number of addresses: the 101st is 429 with Retry-After', async () => {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 15_000) await new Promise((r) => setTimeout(r, left + 100))
  const code = await newBoard()
  const other = await newBoard()
  const results = []
  for (let i = 0; i < 101; i++) results.push(await putPersona(code, (await browser(code)).cookie, custom(`Joiner ${i}`)))
  assert.deepEqual(results.slice(0, 100).map((r) => r.status), Array(100).fill(200))
  assert.equal(results[100].status, 429)
  assert.ok(Number(results[100].res.headers.get('retry-after')) > 0)
  assert.equal((await putPersona(other, (await browser(other)).cookie, custom('Elsewhere'))).status, 200, 'another board has its own budget')
})

test('signing out clears the session but not the browser\'s guest identity', async () => {
  const out = await call(logout, 'POST', '/api/auth/logout', { body: {}, cookie: ann.cookie })
  assert.equal(out.status, 200)
  assert.ok(out.setCookies.some((c) => c.startsWith('rs_session=') && c.includes('Max-Age=0')))
  assert.equal(out.setCookies.some((c) => c.startsWith('rs_g=')), false, 'rs_g is left alone')
})

test('no response body ever contains a private cookie uid', () => {
  assert.ok(rawUids.size > 30)
  for (const text of bodies) for (const raw of rawUids) assert.ok(!text.includes(raw), `a response leaked a cookie uid: ${text.slice(0, 80)}`)
})
