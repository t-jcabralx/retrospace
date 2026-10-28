// Black-box API simulation. Usage: node scripts/sim-api.mjs [baseUrl]  (default http://localhost:3000)
// Start a FRESH dev server first (blanked env): rate-limit counters live in the server process.
// Every request gets its own x-forwarded-for, except where a section deliberately shares one address (the join and
// probing limiter sections), so one section's misses never trip another's per-IP limits.
// Exits non-zero on the first failed assertion.
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const bodies = []
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const PASSWORD = 'correct horse battery'
const CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/

// A browser's cookie jar: remembers Set-Cookie values and sends them back.
class Jar {
  constructor() { this.m = new Map() }
  absorb(setCookies) {
    for (const c of setCookies) {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim())
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (!value || attrs.includes('Max-Age=0')) this.m.delete(name)
      else this.m.set(name, value)
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
  has(name) { return this.m.has(name) }
  get(name) { return this.m.get(name) }
  clone() { const j = new Jar(); j.m = new Map(this.m); return j }
}

// Every request gets its own x-forwarded-for unless one is given, so rate-limit budgets never interfere.
async function call(method, path, body, { jar, raw, headers = {}, ip = fakeIp(), json = true } = {}) {
  const h = { 'x-forwarded-for': ip, ...headers }
  if (json && (body !== undefined || raw !== undefined)) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' })
  const text = await res.text()
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
  const setCookies = res.headers.getSetCookie()
  jar?.absorb(setCookies)
  return { status: res.status, data, res, setCookies }
}

// The server's per-minute limits are fixed windows: a burst that straddles a minute boundary is counted in two
// windows. Sections that depend on an exact count wait for a fresh minute when too little of this one is left.
async function roomInMinute(needMs = 10_000) {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100))
}

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) {
    console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
    process.exit(1)
  }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

async function account(name) {
  const jar = new Jar()
  const r = await call('POST', '/api/auth/register', { email: `${name}-${rnd()}@example.com`, name, password: PASSWORD }, { jar })
  if (r.status !== 200) { console.log('FAIL could not register', name, r.status, r.data); process.exit(1) }
  return { jar, id: r.data.user.id }
}

const note = (id, text = 'hi') => ({ op: 'add', item: { id, kind: 'note', x: 10, y: 20, w: 200, h: 200, data: { text } } })
const mk = (jar, extra) => call('POST', '/api/boards', { ...extra }, { jar })
const get = (code, jar) => call('GET', `/api/boards/${code}`, undefined, { jar })
// `extra` is merged into the body on purpose: the spoofing checks send a uid / name / avatar the server must ignore.
const ops = (code, jar, list, extra = {}) => call('POST', `/api/boards/${code}/ops`, { ops: list, ...extra }, { jar })
const putPersona = (code, jar, persona, extra = {}) => call('PUT', `/api/boards/${code}/persona`, { persona, ...extra }, { jar })
// A browser that has opened the board and chosen a persona: the snapshot mints its rs_g cookie into the jar.
// -> its server-minted uid (null when the board refuses it).
async function as(code, jar, persona = generatePersona()) {
  const snap = await get(code, jar)
  if (snap.status !== 200) return null
  if (!snap.data.viewer.persona) {
    const put = await putPersona(code, jar, persona)
    if (put.status !== 200) { console.log('FAIL could not choose a persona', put.status, put.data); process.exit(1) }
  }
  return snap.data.viewer.uid
}
const patch = (code, jar, p) => call('PATCH', `/api/boards/${code}`, { patch: p }, { jar })

const ann = await account('ann')
const bobAcct = await account('bob')
const guest = new Jar() // a browser with no account

// ---------------------------------------------------------------- accounts and create
let r = await call('POST', '/api/boards', { type: 'workshop', template: 'blank', title: 'x' })
check('create without a session -> 401 Sign in to create a board', r.status === 401 && r.data.error === 'Sign in to create a board', r)
const ws = await mk(ann.jar, { type: 'workshop', template: 'retro', title: 'Sprint retro' })
check('create workshop with a session -> 200 with only a 6-char code', ws.status === 200 && CODE_RE.test(ws.data.code) && JSON.stringify(Object.keys(ws.data)) === '["code"]', ws)
const ce = await mk(ann.jar, { type: 'celebration', template: 'birthday', title: 'For Sam', recipient: { name: 'Sam' } })
check('create celebration -> 200', ce.status === 200 && CODE_RE.test(ce.data.code), ce)
const wa = await mk(ann.jar, { type: 'wall', template: 'team', title: 'Platform team' })
check('create wall -> 200', wa.status === 200 && CODE_RE.test(wa.data.code), wa)
const bad = await mk(ann.jar, { type: 'nope', template: 'x', title: 'x' })
check('create with unknown type -> 400', bad.status === 400 && typeof bad.data.error === 'string', bad)
const sneaky = await call('POST', '/api/boards', { type: 'wall', template: 'team', title: 'x', uid: 'KM-2222-2222-2222', name: 'Mallory', ownerId: bobAcct.id }, { jar: ann.jar })
check('create ignores a uid, name or ownerId in the body (identity comes from the session and the server-minted cookie)', sneaky.status === 200 && (await get(sneaky.data.code, ann.jar)).data.board.ownerId === ann.id, sneaky)
const longTitle = await mk(ann.jar, { type: 'wall', template: 'team', title: 'x'.repeat(81) })
check('create with 81-char title -> 400', longTitle.status === 400, longTitle)
const badJson = await call('POST', '/api/boards', undefined, { jar: ann.jar, raw: '{oops' })
check('malformed JSON -> 400 bad json', badJson.status === 400 && badJson.data.error === 'bad json', badJson)
r = await call('POST', '/api/boards', undefined, { jar: ann.jar, raw: JSON.stringify({ type: 'wall', template: 'team', title: 'x' }), headers: { 'content-type': 'text/plain' }, json: false })
check('create with text/plain -> 415', r.status === 415, r)
r = await call('POST', '/api/boards', { type: 'wall', template: 'team', title: 'x' }, { jar: ann.jar, headers: { origin: 'http://evil.example' } })
check('create with a cross-origin Origin header -> 403', r.status === 403 && r.data.error === 'Cross-origin request blocked', r)

// ---------------------------------------------------------------- GET
const code = ws.data.code
const g = await get(code)
check('GET board (guest, open) -> 200 with board, items, people, participants, now, viewer', g.status === 200 && g.data.board?.code === code && Array.isArray(g.data.items) && Array.isArray(g.data.people) && Array.isArray(g.data.participants) && typeof g.data.now === 'number' && g.data.viewer?.role === 'guest', g)
check('GET board (guest): status open, revoked false, no hash fields, and NO ownerId / createdBy', g.data.board.status === 'open' && g.data.board.revoked === false && !('passcodeHash' in g.data.board) && !('ownerKeyHash' in g.data.board) && !('ownerId' in g.data.board) && !('createdBy' in g.data.board), g.data.board)
check('workshop retro has 3 starter frames', g.data.items.length === 3 && g.data.items.every((i) => i.kind === 'frame'), g.data.items.map((i) => i.id))
r = await get(code, ann.jar)
check('GET board as the owner -> viewer owner with the user id, and the owner still sees ownerId', r.status === 200 && r.data.viewer.role === 'owner' && r.data.viewer.userId === ann.id && r.data.board.ownerId === ann.id && r.data.board.createdBy === ann.id, r.data.viewer)
r = await get(code, bobAcct.jar)
check('GET board as another signed-in account -> viewer guest, no ownerId', r.status === 200 && r.data.viewer.role === 'guest' && r.data.viewer.userId === bobAcct.id && !('ownerId' in r.data.board) && !('createdBy' in r.data.board), r.data.viewer)
check('GET unknown code -> 404', (await get('ZZZZZZ')).status === 404)
check('GET malformed code -> 400', (await get('abc')).status === 400)
const cg = await get(ce.data.code)
const header = cg.data.items.find((i) => i.id === 'starter-header')
check('celebration with recipient has starter header naming the recipient, authored by the owner\'s guest identity under the account name', !!header && header.data.text.includes('Sam') && header.authorName === 'ann' && header.authorUid === (await get(ce.data.code, ann.jar)).data.viewer.uid, header)

// ---------------------------------------------------------------- ops (guest on an open board)
const A = 'item-a'
const guestUid = await as(code, guest) // opens the board (the snapshot mints the signed rs_g cookie) and chooses a persona
const guest2 = new Jar()
const guest2Uid = await as(code, guest2)
r = await ops(code, guest, [note(A)])
check('ops add by a guest (no session) on an open board -> applied, authored by the cookie uid', r.status === 200 && r.data.applied.length === 1 && r.data.rejected.length === 0 && r.data.applied[0].authorUid === guestUid, r)
r = await ops(code, guest, [{ op: 'update', id: A, patch: { x: 99 } }])
check('ops update by author -> applied', r.data.applied.length === 1 && r.data.applied[0].x === 99, r)
r = await ops(code, guest2, [{ op: 'update', id: A, patch: { x: 5 } }])
check('ops update by another guest -> rejected', r.status === 200 && r.data.applied.length === 0 && r.data.rejected.length === 1 && r.data.rejected[0].id === A, r)
r = await ops(code, guest, [{ op: 'bogus', id: A }, note('item-b')])
check('invalid op goes to rejected without failing the request', r.status === 200 && r.data.applied.length === 1 && r.data.rejected.length === 1 && typeof r.data.rejected[0].error === 'string', r)
r = await ops(code, guest2, [{ op: 'update', id: A, patch: { x: 7 } }], { ownerKey: 'x'.repeat(24) })
check('a body ownerKey no longer grants anything', r.data.applied.length === 0 && r.data.rejected.length === 1, r)
r = await ops(code, ann.jar, [{ op: 'update', id: A, patch: { x: 7 } }])
check('ops update by the owner session on another author item -> applied', r.data.applied.length === 1 && r.data.applied[0].x === 7, r)
r = await ops(code, guest, [{ op: 'delete', id: A }])
check('ops delete by author -> applied', r.data.applied.length === 1 && r.data.applied[0].deleted === true, r)
r = await ops(code, new Jar(), [note('item-c')], { uid: guestUid })
check('ops without the guest cookie -> 401 Join the board first, even naming a real uid in the body', r.status === 401 && r.data.error === 'Join the board first', r)
r = await ops(code, guest, [])
check('ops with empty array -> 400', r.status === 400, r)
r = await ops(code, guest, Array.from({ length: 51 }, (_, i) => note(`bulk-${i}`)))
check('ops with 51 ops -> 400', r.status === 400, r)
check('ops on unknown board -> 404', (await ops('ZZZZZZ', guest, [note('x1')])).status === 404)
check('ops on malformed code -> 400', (await ops('abc', guest, [note('x1')])).status === 400)
r = await call('POST', `/api/boards/${code}/ops`, undefined, { jar: guest, raw: JSON.stringify({ ops: [note('t1')] }), headers: { 'content-type': 'text/plain' }, json: false })
check('ops with text/plain -> 415', r.status === 415, r)
r = await call('POST', `/api/boards/${code}/ops`, { ops: [note('t2')] }, { jar: guest, headers: { origin: 'http://evil.example' } })
check('ops with a cross-origin Origin header -> 403', r.status === 403, r)

// ---------------------------------------------------------------- PATCH: owner only
r = await patch(code, guest, { locked: true })
check('PATCH without any session -> 401', r.status === 401, r)
r = await patch(code, bobAcct.jar, { locked: true })
check('PATCH by a second account -> 403 Not the owner', r.status === 403 && r.data.error === 'Not the owner', r)
r = await call('PATCH', `/api/boards/${code}`, { ownerKey: 'x'.repeat(24), patch: { locked: true } }, { jar: guest })
check('PATCH with a body ownerKey and no session -> still refused', r.status === 401 || r.status === 403, r)
r = await patch(code, ann.jar, { locked: true })
check('PATCH locked by the owner -> 200 and board.locked', r.status === 200 && r.data.board.locked === true && !('passcodeHash' in r.data.board), r)
check('PATCH unknown key -> 400', (await patch(code, ann.jar, { color: 'red' })).status === 400)
check('PATCH title too long -> 400', (await patch(code, ann.jar, { title: 'x'.repeat(81) })).status === 400)
check('PATCH vote perPerson out of range -> 400', (await patch(code, ann.jar, { vote: { active: true, perPerson: 99 } })).status === 400)
check('PATCH ownerId / passcodeHash cannot be set directly -> 400', (await patch(code, ann.jar, { ownerId: bobAcct.id })).status === 400 && (await patch(code, ann.jar, { passcodeHash: 'x' })).status === 400)
r = await patch(code, ann.jar, { title: 'Renamed', vote: { active: true, perPerson: 3 }, revealAt: '2030-01-01T00:00:00.000Z', timer: { endsAt: Date.now() + 60000, durationMs: 60000 }, recipient: { name: 'Zed' } })
check('PATCH multiple valid settings -> 200', r.status === 200 && r.data.board.title === 'Renamed' && r.data.board.vote.perPerson === 3 && r.data.board.recipient.name === 'Zed' && !!r.data.board.revealAt, r)
r = await patch(code, ann.jar, { revealAt: null, timer: null, recipient: null })
check('PATCH nullable settings -> cleared', r.status === 200 && r.data.board.revealAt == null && r.data.board.timer == null && r.data.board.recipient == null, r)
r = await call('PATCH', `/api/boards/${code}`, { patch: { title: 'hijack' } }, { jar: ann.jar, headers: { origin: 'http://evil.example' } })
check('PATCH with a cross-origin Origin header -> 403', r.status === 403, r)
r = await call('PATCH', `/api/boards/${code}`, undefined, { jar: ann.jar, raw: JSON.stringify({ patch: { title: 'x' } }), headers: { 'content-type': 'text/plain' }, json: false })
check('PATCH with text/plain -> 415', r.status === 415, r)
r = await ops(code, guest2, [note('item-d')])
check('guest add on a locked board -> rejected entry', r.status === 200 && r.data.applied.length === 0 && r.data.rejected.length === 1 && r.data.rejected[0].error === 'Board is locked', r)
r = await ops(code, ann.jar, [note('item-d')])
check('owner add on a locked board -> applied', r.data.applied.length === 1, r)

// ---------------------------------------------------------------- since
r = await call('GET', `/api/boards/${code}/since?t=0`)
const tomb = r.data.items?.find((i) => i.id === A)
check('since?t=0 includes the tombstone', r.status === 200 && tomb?.deleted === true && typeof r.data.now === 'number', r)
const newest = Math.max(...r.data.items.map((i) => i.updatedAt))
r = await call('GET', `/api/boards/${code}/since?t=${newest}`)
check('since?t=<newest> returns nothing', r.status === 200 && r.data.items.length === 0, r)
check('since without t -> 400', (await call('GET', `/api/boards/${code}/since`)).status === 400)
check('since?t=abc -> 400', (await call('GET', `/api/boards/${code}/since?t=abc`)).status === 400)
check('since on malformed code -> 400', (await call('GET', '/api/boards/abc/since?t=0')).status === 400)
check('since on unknown board -> 404', (await call('GET', '/api/boards/ZZZZZZ/since?t=0')).status === 404)
r = await call('GET', `/api/boards/${code}/since?t=${newest}`)
const boardBefore = r.data.board
check('since carries the guest-safe board next to the items (no ownerId, createdBy or passcodeHash)', r.status === 200 && boardBefore?.code === code && typeof boardBefore.updatedAt === 'number' && !['ownerId', 'createdBy', 'passcodeHash'].some((k) => k in boardBefore), r)
r = await call('PATCH', `/api/boards/${code}`, { patch: { title: 'Retitled live' }, cid: 'has space' }, { jar: ann.jar })
check('PATCH with an invalid cid -> 400 and nothing changes', r.status === 400 && (await call('GET', `/api/boards/${code}/since?t=${newest}`)).data.board.title === boardBefore.title, r)
r = await call('PATCH', `/api/boards/${code}`, { patch: { title: 'Retitled live' }, cid: 'tab-1_A' }, { jar: ann.jar })
check('PATCH with a valid cid -> 200', r.status === 200 && r.data.board.title === 'Retitled live', r)
r = await call('GET', `/api/boards/${code}/since?t=${newest}`)
check('after the owner PATCH, /since returns the new board (what a polling client converges on)', r.data.board.title === 'Retitled live' && r.data.board.updatedAt > boardBefore.updatedAt && !JSON.stringify(r.data).includes(ann.id), r)
const revA = r.data.board.rev
check('the board carries a settings revision (rev), bumped by the PATCH above', Number.isInteger(revA) && revA >= 1 && revA === boardBefore.rev + 1, { before: boardBefore.rev, after: revA })
r = await patch(code, ann.jar, { rev: 99 })
check('a PATCH cannot set rev (unknown setting -> 400)', r.status === 400, r)
const quick = await Promise.all([patch(code, ann.jar, { title: 'Quick one' }), patch(code, ann.jar, { title: 'Quick two' })])
check('two quick PATCHes both succeed with different revs', quick.every((q) => q.status === 200) && new Set(quick.map((q) => q.data.board.rev)).size === 2, quick.map((q) => q.data.board?.rev))
r = await call('GET', `/api/boards/${code}/since?t=${newest}`)
const revB = r.data.board.rev
check('/since shows both: rev moved by exactly 2 and the title is the later one', revB === revA + 2 && r.data.board.title === quick.sort((x, y) => x.data.board.rev - y.data.board.rev).at(-1).data.board.title, { revA, revB })
r = await ops(code, ann.jar, [note('rev-note-1')])
check('an item op writes without touching rev', r.status === 200 && r.data.applied.length === 1 && (await call('GET', `/api/boards/${code}/since?t=${newest}`)).data.board.rev === revB, r)

// ---------------------------------------------------------------- people
const wcode = wa.data.code
const people = [{ id: 'p1', name: 'Dana', birthday: '03-14', startDate: '2022-05-01' }, { id: 'p2', name: 'Eli', birthday: null, startDate: null }]
const savePeople = (jar, list) => call('POST', `/api/boards/${wcode}/people`, { people: list }, { jar })
check('people POST without a session -> 401', (await savePeople(guest, people)).status === 401)
check('people POST by a second account -> 403', (await savePeople(bobAcct.jar, people)).status === 403)
check('people POST with bad birthday -> 400', (await savePeople(ann.jar, [{ id: 'p1', name: 'Dana', birthday: '13-40', startDate: null }])).status === 400)
check('people POST with bad startDate -> 400', (await savePeople(ann.jar, [{ id: 'p1', name: 'Dana', birthday: null, startDate: 'not a date' }])).status === 400)
r = await savePeople(ann.jar, people)
check('people POST by the owner -> 200 and saved', r.status === 200 && r.data.people.length === 2 && r.data.people[0].name === 'Dana', r)
check('GET wall returns the people', (await get(wcode)).data.people.length === 2)
r = await call('POST', `/api/boards/${wcode}/people`, { people }, { jar: ann.jar, headers: { origin: 'http://evil.example' } })
check('people POST with a cross-origin Origin header -> 403', r.status === 403, r)

// ---------------------------------------------------------------- many boards per owner, one unique key each
const carol = await account('carol')
r = await call('GET', '/api/my-boards')
check('my-boards without a session -> 401', r.status === 401, r)
r = await call('GET', '/api/my-boards', undefined, { jar: carol.jar })
check('my-boards for a fresh account -> empty', r.status === 200 && r.data.boards.length === 0, r)
const mix = [['workshop', 'blank'], ['celebration', 'birthday'], ['wall', 'team'], ['workshop', 'retro'], ['celebration', 'farewell']]
const made = []
for (const [i, [type, template]] of mix.entries()) {
  const b = await mk(carol.jar, { type, template, title: `Carol ${i} ${type}` })
  if (b.status !== 200) check(`create board ${i}`, false, b)
  made.push({ code: b.data.code, type, title: `Carol ${i} ${type}` })
}
check('5 boards by one account -> 5 distinct 6-char codes', new Set(made.map((m) => m.code)).size === 5 && made.every((m) => CODE_RE.test(m.code)), made.map((m) => m.code))
r = await call('GET', '/api/my-boards', undefined, { jar: carol.jar })
const listed = new Map(r.data.boards.map((b) => [b.code, b]))
check('my-boards lists all 5 with their own title and type', r.status === 200 && made.every((m) => listed.get(m.code)?.title === m.title && listed.get(m.code)?.type === m.type) && r.data.boards.length === 5, r.data.boards.map((b) => [b.code, b.type, b.title]))
check('my-boards is newest first', r.data.boards.every((b, i) => i === 0 || r.data.boards[i - 1].updatedAt >= b.updatedAt))
check('my-boards owner is the account and nothing is hashed', r.data.boards.every((b) => b.ownerId === carol.id && !('passcodeHash' in b) && !('ownerKeyHash' in b)))
r = await call('GET', '/api/my-boards', undefined, { jar: bobAcct.jar })
check('a second account sees none of them', r.status === 200 && r.data.boards.every((b) => !made.some((m) => m.code === b.code)), r.data.boards.map((b) => b.code))
r = await call('GET', '/api/my-boards', undefined, { jar: ann.jar })
check('the first account lists its own boards (4 so far)', r.data.boards.map((b) => b.code).sort().join() === [code, ce.data.code, wcode, sneaky.data.code].sort().join(), r.data.boards.map((b) => b.code))

// ---------------------------------------------------------------- a code opens only its own board
const boardA = made[0].code
const boardB = made[1].code // gets a passcode below
const boardC = made[2].code // stays open
const visitor = new Jar()
r = await call('POST', `/api/boards/${boardA}/join`, { passcode: undefined }, { jar: visitor })
check('a guest joins board A (no passcode) -> ok, no cookie needed', r.status === 200 && r.data.ok === true, r)
await as(boardA, visitor)
r = await ops(boardA, visitor, [note('mine-a', 'A secret')])
check('the guest writes to A', r.status === 200 && r.data.applied.length === 1, r)
r = await patch(boardB, carol.jar, { passcode: 'passcode-B' })
check('owner sets a passcode on board B -> 200 without leaking it or its hash', r.status === 200 && !JSON.stringify(r.data).includes('passcode-B') && !('passcodeHash' in r.data.board), r)
for (const [label, res] of [
  ['snapshot', await get(boardB, visitor)],
  ['ops', await ops(boardB, visitor, [note('x', 'nope')])],
  ['since', await call('GET', `/api/boards/${boardB}/since?t=0`, undefined, { jar: visitor })],
  ['rt join', await call('POST', '/api/rt/join', { code: boardB }, { jar: visitor })],
  ['persona', await putPersona(boardB, visitor, generatePersona())],
]) check(`the guest who joined A cannot use ${label} on passcode board B -> 401`, res.status === 401 && res.data.error === 'Passcode required' && !JSON.stringify(res.data).includes('A secret'), res)
r = await call('GET', `/api/join/${boardC}`)
check('board C (open) shows a stranger only its public join info', r.status === 200 && JSON.stringify(Object.keys(r.data).sort()) === JSON.stringify(['closed', 'exists', 'needsPasscode', 'revoked', 'title', 'type']) && r.data.title === made[2].title && r.data.type === 'wall', r)
check('the join info never mentions the owner or board A', !/ownerId|createdBy|A secret|u_[0-9a-f]{16}/.test(JSON.stringify(r.data)) && !JSON.stringify(r.data).includes(boardA))
r = await get(boardC, visitor)
check('and with the code the guest reads C itself, containing nothing from A', r.status === 200 && r.data.board.code === boardC && !JSON.stringify(r.data.items).includes('A secret'), r.data.board)

// ---------------------------------------------------------------- join info
r = await call('GET', `/api/join/${boardB}`)
check('GET /api/join/[code] on a passcode board -> exactly five fields, needsPasscode true', r.status === 200 && JSON.stringify(r.data) === JSON.stringify({ exists: true, title: made[1].title, type: 'celebration', needsPasscode: true, closed: false, revoked: false }), r)
r = await call('GET', '/api/join/ZZZZZZ')
check('GET /api/join/[code] unknown -> 404 { exists: false }', r.status === 404 && JSON.stringify(r.data) === '{"exists":false}', r)
check('GET /api/join/[code] malformed -> 400', (await call('GET', '/api/join/abc')).status === 400)
r = await call('GET', `/api/join/${boardB}`, undefined, { jar: ann.jar })
check('join info does not change for a signed-in stranger', JSON.stringify(Object.keys(r.data)) === '["exists","title","type","needsPasscode","closed","revoked"]', r)

// ---------------------------------------------------------------- the passcode flow
const pc = made[3].code
await ops(pc, carol.jar, [note('pc1', 'inside the passcode board')])
r = await patch(pc, carol.jar, { passcode: 'abc' })
check('PATCH passcode shorter than 4 characters -> 400', r.status === 400, r)
check('PATCH passcode longer than 64 characters -> 400', (await patch(pc, carol.jar, { passcode: 'x'.repeat(65) })).status === 400)
r = await patch(pc, carol.jar, { passcode: 'open sesame' })
check('PATCH passcode by the owner -> 200', r.status === 200 && !('passcodeHash' in r.data.board) && !JSON.stringify(r.data).includes('open sesame'), r)
const door = new Jar()
for (const [label, res] of [
  ['snapshot', await get(pc, door)],
  ['ops', await ops(pc, door, [note('x')])],
  ['since', await call('GET', `/api/boards/${pc}/since?t=0`, undefined, { jar: door })],
  ['rt join', await call('POST', '/api/rt/join', { code: pc }, { jar: door })],
  ['persona', await putPersona(pc, door, generatePersona())],
]) check(`passcode board: ${label} without the access cookie -> 401 Passcode required`, res.status === 401 && res.data.error === 'Passcode required', res)
r = await get(pc, carol.jar)
check('the owner reads a passcode board without a cookie', r.status === 200 && r.data.viewer.role === 'owner', r.status)
r = await call('POST', `/api/boards/${pc}/join`, { passcode: 'wrong guess' }, { jar: door })
check('wrong passcode -> 403 Wrong passcode, no cookie', r.status === 403 && r.data.error === 'Wrong passcode' && r.setCookies.length === 0, r)
r = await call('POST', `/api/boards/${pc}/join`, {}, { jar: door })
check('missing passcode -> 403 Wrong passcode', r.status === 403 && r.data.error === 'Wrong passcode', r)
r = await call('POST', `/api/boards/${pc}/join`, { passcode: 'open sesame' }, { jar: door })
const accessCookieName = `rs_a_${pc}`
const setAccess = r.setCookies.find((c) => c.startsWith(`${accessCookieName}=`)) || ''
const attrs = setAccess.split(';').map((s) => s.trim())
check('right passcode -> 200 and an HttpOnly SameSite=Lax Path=/ 30-day access cookie', r.status === 200 && r.data.ok === true && ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'].every((f) => attrs.includes(f)), setAccess.split(';').slice(1))
const cookieValue = door.get(accessCookieName)
check('the cookie value is not the passcode or a scrypt hash', /^[0-9a-f]{64}$/.test(cookieValue) && !setAccess.includes('open sesame') && !setAccess.includes('scrypt'), cookieValue?.length)
r = await get(pc, door)
check('with the cookie: snapshot -> 200 as a guest', r.status === 200 && r.data.viewer.role === 'guest' && r.data.items.some((i) => i.id === 'pc1'), r.status)
await as(pc, door)
r = await ops(pc, door, [note('g-ok')])
check('with the cookie: ops -> applied', r.status === 200 && r.data.applied.length === 1, r)
r = await call('GET', `/api/boards/${pc}/since?t=0`, undefined, { jar: door })
check('with the cookie: since -> 200', r.status === 200 && Array.isArray(r.data.items), r.status)
r = await call('POST', '/api/rt/join', { code: pc }, { jar: door })
check('with the cookie: rt join -> 200 with an expiring token (<expMs>.<hmac>) 30 minutes ahead', r.status === 200 && /^\d+\.[0-9a-f]{32}$/.test(r.data.tok ?? '') && Math.abs(Number(r.data.tok.split('.')[0]) - (Date.now() + 30 * 60_000)) < 60_000, r.data.tok && r.data.tok.slice(0, 14))
const oldDoor = door.clone()
r = await patch(pc, carol.jar, { passcode: 'a brand new one' })
check('owner changes the passcode -> 200', r.status === 200, r)
r = await get(pc, oldDoor)
check('changing the passcode invalidates the old cookie -> 401', r.status === 401 && r.data.error === 'Passcode required', r)
r = await call('POST', `/api/boards/${pc}/join`, { passcode: 'open sesame' }, { jar: new Jar() })
check('the old passcode no longer works -> 403', r.status === 403, r)
r = await call('POST', `/api/boards/${pc}/join`, { passcode: 'a brand new one' }, { jar: oldDoor })
check('the new passcode works and replaces the cookie', r.status === 200 && (await get(pc, oldDoor)).status === 200)
r = await patch(pc, carol.jar, { passcode: null })
check('owner clears the passcode -> 200', r.status === 200 && r.data.board.passcodeHash === undefined, r)
check('cleared passcode: an anonymous guest reads the board again', (await get(pc, new Jar())).status === 200)
r = await call('POST', `/api/boards/${pc}/join`, { passcode: 'whatever' }, { jar: new Jar() })
check('join on a board without a passcode -> 200 ok, no cookie', r.status === 200 && r.data.ok === true && r.setCookies.length === 0, r)
r = await call('POST', `/api/boards/${pc}/join`, { passcode: 'x' }, { headers: { origin: 'http://evil.example' } })
check('join with a cross-origin Origin header -> 403', r.status === 403, r)
r = await call('POST', `/api/boards/${pc}/join`, undefined, { raw: '{}', headers: { 'content-type': 'text/plain' }, json: false })
check('join with text/plain -> 415', r.status === 415, r)
check('join on an unknown board -> 404', (await call('POST', '/api/boards/ZZZZZZ/join', {})).status === 404)
check('join on a malformed code -> 400', (await call('POST', '/api/boards/abc/join', {})).status === 400)

// ---------------------------------------------------------------- join rate limits
const lim = made[4].code
await patch(lim, carol.jar, { passcode: 'limit-test-1' })
await roomInMinute()
const sameIp = fakeIp()
const statuses = []
for (let i = 0; i < 11; i++) statuses.push((await call('POST', `/api/boards/${lim}/join`, { passcode: `wrong-${i}` }, { ip: sameIp })).status)
check('join: 10 attempts a minute per IP, the 11th -> 429', statuses.slice(0, 10).every((s) => s === 403) && statuses[10] === 429, statuses)
r = await call('POST', `/api/boards/${lim}/join`, { passcode: 'wrong-again' }, { ip: sameIp })
check('429 on join carries Retry-After', r.status === 429 && Number(r.res.headers.get('retry-after')) > 0, r.res.headers.get('retry-after'))
let tripped = 0
for (let i = 0; i < 25 && !tripped; i++) {
  const t = await call('POST', `/api/boards/${lim}/join`, { passcode: `spray-${i}` })
  if (t.status === 429) tripped = i + 1
}
check('join: after 30 failed attempts at one board (many IPs) it locks', tripped > 0 && tripped <= 21, tripped)
r = await call('POST', `/api/boards/${lim}/join`, { passcode: 'limit-test-1' })
check('and even the right passcode is refused while locked, with Retry-After', r.status === 429 && Number(r.res.headers.get('retry-after')) > 0, r)
r = await call('POST', `/api/boards/${boardC}/join`, {})
check('another board is not locked by that', r.status === 200, r)

// ---------------------------------------------------------------- closed
const cl = made[0].code
r = await patch(cl, carol.jar, { status: 'nope' })
check('PATCH status must be open or closed -> 400', r.status === 400, r)
r = await patch(cl, bobAcct.jar, { status: 'closed' })
check('a second account cannot close the board -> 403', r.status === 403, r)
r = await patch(cl, carol.jar, { status: 'closed' })
check('owner closes the board -> 200 status closed', r.status === 200 && r.data.board.status === 'closed', r)
r = await ops(cl, visitor, [note('after-close')])
check('closed: guest ops -> 403 Board is closed', r.status === 403 && r.data.error === 'Board is closed', r)
r = await ops(cl, bobAcct.jar, [note('after-close-2')])
check('closed: another account ops -> 403 Board is closed', r.status === 403 && r.data.error === 'Board is closed', r)
r = await get(cl, visitor)
check('closed: guests can still read (status closed visible)', r.status === 200 && r.data.board.status === 'closed' && r.data.viewer.role === 'guest', r.status)
r = await call('GET', `/api/join/${cl}`)
check('closed: join info says closed', r.data.closed === true && r.data.revoked === false, r)
r = await ops(cl, carol.jar, [note('owner-after-close')])
check('closed: owner ops still applied', r.status === 200 && r.data.applied.length === 1, r)
r = await patch(cl, carol.jar, { status: 'open' })
check('owner reopens -> 200', r.status === 200 && r.data.board.status === 'open')
r = await ops(cl, visitor, [note('after-reopen')])
check('reopened: guest ops applied again', r.status === 200 && r.data.applied.length === 1, r)

// ---------------------------------------------------------------- revoked
r = await patch(cl, carol.jar, { revoked: 'yes' })
check('PATCH revoked must be a boolean -> 400', r.status === 400, r)
r = await patch(cl, carol.jar, { revoked: true })
check('owner revokes -> 200', r.status === 200 && r.data.board.revoked === true, r)
for (const [label, res] of [
  ['snapshot', await get(cl, visitor)],
  ['ops', await ops(cl, visitor, [note('r1')])],
  ['since', await call('GET', `/api/boards/${cl}/since?t=0`, undefined, { jar: visitor })],
  ['rt join', await call('POST', '/api/rt/join', { code: cl }, { jar: visitor })],
  ['persona', await putPersona(cl, visitor, generatePersona())],
  ['join', await call('POST', `/api/boards/${cl}/join`, {}, { jar: visitor })],
]) check(`revoked: guest ${label} -> 403 This link was revoked`, res.status === 403 && res.data.error === 'This link was revoked', res)
r = await get(cl, bobAcct.jar)
check('revoked: another signed-in account -> 403', r.status === 403, r.status)
r = await get(cl, carol.jar)
check('revoked: the owner still reads (200)', r.status === 200 && r.data.viewer.role === 'owner', r.status)
r = await ops(cl, carol.jar, [note('r-owner')])
check('revoked: owner ops still applied', r.status === 200 && r.data.applied.length === 1, r)
r = await call('GET', `/api/join/${cl}`)
check('revoked: join info says revoked', r.status === 200 && r.data.revoked === true && JSON.stringify(Object.keys(r.data)) === '["exists","title","type","needsPasscode","closed","revoked"]', r)
r = await patch(cl, carol.jar, { revoked: false })
check('owner un-revokes -> guests are back', r.status === 200 && (await get(cl, visitor)).status === 200)

// ---------------------------------------------------------------- Origin: null on every mutating route
{
  const o = (origin) => ({ headers: { origin } })
  for (const origin of ['null', 'http://evil.example']) {
    const label = origin === 'null' ? 'Origin: null' : 'a foreign Origin'
    const t = made[2].code
    const results = [
      ['create', await call('POST', '/api/boards', { type: 'wall', template: 'team', title: 'x' }, { jar: carol.jar, ...o(origin) })],
      ['PATCH', await call('PATCH', `/api/boards/${t}`, { patch: { title: 'hijack' } }, { jar: carol.jar, ...o(origin) })],
      ['DELETE', await call('DELETE', `/api/boards/${t}`, undefined, { jar: carol.jar, ...o(origin) })],
      ['ops', await call('POST', `/api/boards/${t}/ops`, { ops: [note('origin-test')] }, { jar: guest, ...o(origin) })],
      ['people', await call('POST', `/api/boards/${t}/people`, { people: [] }, { jar: carol.jar, ...o(origin) })],
      ['join', await call('POST', `/api/boards/${t}/join`, {}, o(origin))],
      ['rt join', await call('POST', '/api/rt/join', { code: t }, { jar: guest, ...o(origin) })],
      ['persona', await call('PUT', `/api/boards/${t}/persona`, { persona: generatePersona() }, { jar: guest, ...o(origin) })],
    ]
    check(`every mutating route refuses ${label} -> 403 (create, PATCH, DELETE, ops, people, join, rt join, persona)`, results.every(([, x]) => x.status === 403), results.map(([k, x]) => [k, x.status]))
  }
  check('and nothing changed on the targeted board', (await get(made[2].code)).data.board.title === made[2].title)
}

// ---------------------------------------------------------------- probing limiter (one shared address on purpose)
{
  await roomInMinute()
  const probeIp = fakeIp()
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const miss = (i, ip = probeIp) => call('GET', `/api/boards/ZZZZ2${letters[i % letters.length]}`, undefined, { ip })
  let s = []
  for (let i = 0; i < 21; i++) s.push((await miss(i)).status)
  check('probing: 20 unknown codes a minute from one IP are 404, the 21st is 429', s.slice(0, 20).every((x) => x === 404) && s[20] === 429, s)
  r = await miss(0)
  check('probing: the 429 carries Retry-After', r.status === 429 && Number(r.res.headers.get('retry-after')) > 0, r.res.headers.get('retry-after'))
  r = await call('GET', `/api/boards/${made[2].code}`, undefined, { ip: probeIp })
  check('probing: the blocked IP is refused for existing boards too', r.status === 429, r.status)
  check('probing: another IP is unaffected', (await miss(0, fakeIp())).status === 404)
  const pollIp = fakeIp()
  let throttled = 0
  for (let i = 0; i < 120; i++) if ((await call('GET', `/api/boards/${made[2].code}/since?t=0`, undefined, { ip: pollIp })).status === 429) throttled++
  check('probing: 120 successful polls from one IP are never throttled', throttled === 0, throttled)
}

// ---------------------------------------------------------------- DELETE
const del = (jar, extra) => call('DELETE', `/api/boards/${code}`, undefined, { jar, ...extra })
check('DELETE without a session -> 401', (await del(guest)).status === 401)
check('DELETE by a second account -> 403', (await del(bobAcct.jar)).status === 403)
r = await del(ann.jar, { headers: { origin: 'http://evil.example' } })
check('DELETE with a cross-origin Origin header -> 403', r.status === 403, r)
check('the board still exists after the refused deletes', (await get(code)).status === 200)
r = await del(ann.jar)
check('DELETE by the owner (no body needed) -> ok', r.status === 200 && r.data.ok === true, r)
check('GET after DELETE -> 404', (await get(code)).status === 404)
r = await call('GET', '/api/my-boards', undefined, { jar: ann.jar })
check('a deleted board leaves my-boards', !r.data.boards.some((b) => b.code === code), r.data.boards.map((b) => b.code))

// ---------------------------------------------------------------- Task 7B: voting, reset, timer, throwables, passcode through PATCH
{
  const owner = await account('olga')
  const vb = (await mk(owner.jar, { type: 'workshop', template: 'blank', title: 'Voting' })).data.code
  const g1 = new Jar()
  const g2 = new Jar()
  const u1 = await as(vb, g1)
  const u2 = await as(vb, g2)
  await ops(vb, owner.jar, [note('v1'), note('v2'), note('v3')])
  const vote = (id) => ({ op: 'vote', id })
  const revOf = async () => (await get(vb, owner.jar)).data.board.rev
  const fresh = await get(vb, owner.jar)
  check('a new board has voting stopped (3 per person), no timer and throwing off with the eight defaults', fresh.data.board.vote.active === false && fresh.data.board.vote.perPerson === 3 && fresh.data.board.timer === null && fresh.data.board.throwables.enabled === false && fresh.data.board.throwables.emojis.length === 8, fresh.data.board)

  r = await ops(vb, g1, [vote('v1')])
  check('a vote while voting is stopped -> rejected "Voting is not open"', r.status === 200 && r.data.applied.length === 0 && r.data.rejected[0]?.error === 'Voting is not open', r)
  r = await ops(vb, owner.jar, [vote('v1')])
  check('...the owner included', r.data.rejected[0]?.error === 'Voting is not open', r)
  const rev0 = await revOf()
  r = await patch(vb, owner.jar, { vote: { active: true, perPerson: 2 } })
  check('PATCH vote start (2 per person) -> 200 and rev goes up', r.status === 200 && r.data.board.vote.active === true && r.data.board.rev === rev0 + 1, r.data.board)
  await ops(vb, owner.jar, [{ op: 'add', item: { id: 'fr1', kind: 'frame', x: 0, y: 0, w: 300, h: 300, data: { title: 'A frame' } } }])
  r = await ops(vb, g2, [vote('fr1')])
  check('a frame cannot be voted for -> rejected "Can\'t vote on this", and it costs no vote', r.data.applied.length === 0 && r.data.rejected[0]?.error === 'Can\'t vote on this', r)
  r = await ops(vb, g1, [vote('v1'), vote('v2'), vote('v3')])
  check('a guest gets exactly perPerson votes: two applied, the third "No votes left"', r.data.applied.length === 2 && r.data.rejected.length === 1 && r.data.rejected[0].id === 'v3' && r.data.rejected[0].error === 'No votes left', r)
  r = await ops(vb, g2, [vote('v3'), vote('v1')])
  check('another guest has their own budget, and votes stack on an item', r.data.applied.length === 2 && r.data.applied[1].votes.length === 2, r)
  r = await ops(vb, g1, [vote('v1')])
  check('taking your own vote back is always allowed', r.data.applied[0]?.votes.length === 1 && !r.data.applied[0].votes.includes(u1), r)
  r = await ops(vb, g1, [vote('v3')])
  check('...and frees a slot for another item', r.data.applied.length === 1, r)
  r = await ops(vb, owner.jar, [vote('v1'), vote('v2'), vote('v3')])
  check('the owner has a budget too (2 of 3 applied)', r.data.applied.length === 2 && r.data.rejected[0]?.error === 'No votes left', r)
  r = await ops(vb, g2, [vote('nope')])
  check('a vote on a missing item -> Item not found', r.data.rejected[0]?.error === 'Item not found', r)
  r = await patch(vb, owner.jar, { locked: true })
  r = await ops(vb, g2, [vote('v2')])
  check('a locked board still refuses a guest vote (Board is locked) before anything about voting', r.data.rejected[0]?.error === 'Board is locked', r)
  await patch(vb, owner.jar, { locked: false })

  const before = (await get(vb, owner.jar)).data
  const revBefore = before.board.rev
  r = await call('POST', `/api/boards/${vb}/votes/reset`, {}, { jar: g1 })
  check('votes/reset by a guest -> 401 (no session)', r.status === 401, r)
  r = await call('POST', `/api/boards/${vb}/votes/reset`, {}, { jar: bobAcct.jar })
  check('votes/reset by another account -> 403 Not the owner', r.status === 403 && r.data.error === 'Not the owner', r)
  r = await call('POST', `/api/boards/${vb}/votes/reset`, {}, { jar: owner.jar, headers: { origin: 'http://evil.example' } })
  check('votes/reset with a foreign Origin -> 403', r.status === 403, r)
  r = await call('POST', `/api/boards/${vb}/votes/reset`, undefined, { jar: owner.jar, raw: '{}', headers: { 'content-type': 'text/plain' }, json: false })
  check('votes/reset with text/plain -> 415', r.status === 415, r)
  r = await call('POST', `/api/boards/${vb}/votes/reset`, { cid: 'bad cid' }, { jar: owner.jar })
  check('votes/reset with an invalid cid -> 400', r.status === 400, r)
  const voted = before.items.filter((i) => i.votes?.length).length
  r = await call('POST', `/api/boards/${vb}/votes/reset`, {}, { jar: owner.jar })
  check('votes/reset by the owner -> { cleared: <items that had votes>, skipped: 0 }', r.status === 200 && JSON.stringify(r.data) === JSON.stringify({ cleared: voted, skipped: 0 }) && voted === 3, { r, voted })
  const after = (await get(vb, owner.jar)).data
  check('every item has no votes afterwards, and rev did not change', after.items.every((i) => i.votes.length === 0) && after.board.rev === revBefore, after.board.rev)
  r = await call('GET', `/api/boards/${vb}/since?t=${Math.max(...before.items.map((i) => i.updatedAt))}`)
  check('/since carries the cleared items so polling clients converge', r.data.items.length === 3 && r.data.items.every((i) => i.votes.length === 0), r.data.items.length)
  r = await ops(vb, g1, [vote('v1'), vote('v2')])
  check('after a reset everyone has a full budget again', r.data.applied.length === 2, r)
  check('votes/reset on an unknown board -> 404', (await call('POST', '/api/boards/ZZZZZZ/votes/reset', {}, { jar: owner.jar })).status === 404)
  r = await patch(vb, owner.jar, { vote: { active: false, perPerson: 2 } })
  r = await ops(vb, g2, [vote('v1')])
  check('stopping voting stops votes again', r.data.rejected[0]?.error === 'Voting is not open', r)

  // timer
  const now = Date.now()
  r = await patch(vb, owner.jar, { timer: { endsAt: now + 60_000 } })
  check('PATCH timer without durationMs -> 400', r.status === 400, r)
  for (const [label, t] of [['a duration under 10 s', { endsAt: now + 60_000, durationMs: 5_000 }], ['a duration over 4 h', { endsAt: now + 60_000, durationMs: 4 * 3600_000 + 1 }], ['an end 5 minutes in the past', { endsAt: now - 300_000, durationMs: 60_000 }], ['an end 5 hours away', { endsAt: now + 5 * 3600_000, durationMs: 60_000 }], ['a string end', { endsAt: 'soon', durationMs: 60_000 }]])
    check(`PATCH timer with ${label} -> 400`, (await patch(vb, owner.jar, { timer: t })).status === 400)
  check('PATCH timer ending more than a minute after now + duration -> 400', (await patch(vb, owner.jar, { timer: { endsAt: now + 3 * 3600_000, durationMs: 60_000 } })).status === 400)
  check('PATCH timer that ended 10 seconds ago -> 400', (await patch(vb, owner.jar, { timer: { endsAt: now - 10_000, durationMs: 60_000 } })).status === 400)
  r = await patch(vb, owner.jar, { timer: { endsAt: now + 300_000, durationMs: 300_000 } })
  check('PATCH timer 5 min -> 200 and every client sees { endsAt, durationMs }', r.status === 200 && r.data.board.timer.durationMs === 300_000 && r.data.board.timer.endsAt === now + 300_000, r)
  r = await call('GET', `/api/boards/${vb}/since?t=0`)
  check('/since gives guests the timer and the server clock', r.data.board.timer?.durationMs === 300_000 && Math.abs(r.data.now - Date.now()) < 5_000, r.data.board.timer)
  r = await patch(vb, owner.jar, { timer: { endsAt: now + 360_000, durationMs: 360_000 } })
  check('+1 min (a second PATCH) -> 200', r.status === 200 && r.data.board.timer.durationMs === 360_000)
  r = await patch(vb, owner.jar, { timer: null })
  check('PATCH timer null stops it', r.status === 200 && r.data.board.timer === null, r)
  r = await patch(vb, g1, { timer: null })
  check('a guest cannot set the timer -> 401/403', r.status === 401 || r.status === 403, r)

  // throwables
  const E = ['🍌', '🗑️', '👩‍💻']
  for (const [label, t] of [['no emojis', { enabled: true, emojis: [] }], ['text', { enabled: true, emojis: ['a'] }], ['two emoji in one entry', { enabled: true, emojis: ['🍌🍌'] }], ['duplicates', { enabled: true, emojis: ['🍌', '🍌'] }], ['markup', { enabled: true, emojis: ['<b>'] }], ['13 emoji', { enabled: true, emojis: ['🍌', '🗑️', '🐵', '🍅', '🌹', '❤️', '👏', '🎉', '🔥', '😂', '🙌', '🚀', '🧀'] }], ['enabled as a string', { enabled: 'yes', emojis: ['🍌'] }]])
    check(`PATCH throwables with ${label} -> 400`, (await patch(vb, owner.jar, { throwables: t })).status === 400)
  r = await patch(vb, owner.jar, { throwables: { enabled: true, emojis: E } })
  check('PATCH throwables with valid emoji (a ZWJ sequence too) -> 200', r.status === 200 && r.data.board.throwables.enabled === true && r.data.board.throwables.emojis.join() === E.join(), r)
  r = await patch(vb, owner.jar, { throwables: { enabled: false, emojis: E } })

  // rt/send: throw rules (no Redis here: the rules are checked before there is anything to relay to)
  const tokOf = async (jar) => (await call('POST', '/api/rt/join', { code: vb }, { jar })).data.tok
  const sendAs = async (jar, uid, msg) => call('POST', '/api/rt/send', { code: vb, uid, tok: await tokOf(jar), msg }, { jar })
  const T = { t: 'throw', emoji: '🍌', itemId: 'v1', x: 10, y: 20 }
  r = await sendAs(g1, u1, T)
  check('a throw while throwing is off -> 403 Throwing is off', r.status === 403 && r.data.error === 'Throwing is off', r)
  await patch(vb, owner.jar, { throwables: { enabled: true, emojis: E } })
  r = await sendAs(g1, u1, { ...T, emoji: '🍅' })
  check('an emoji that is not on the list -> 403', r.status === 403, r)
  r = await sendAs(g1, u1, { ...T, x: 'left' })
  check('a malformed throw -> 400', r.status === 400, r)
  if (4500 - (Date.now() % 4500) < 1500) await new Promise((res) => setTimeout(res, 1600)) // the limit is a fixed 4.5 s window: do not straddle its edge
  r = await sendAs(g1, u1, T)
  check('a listed emoji with throwing on -> 200', r.status === 200, r)
  r = await sendAs(g1, u1, T)
  r = await sendAs(g1, u1, T)
  const fourth = await sendAs(g1, u1, T)
  check('the burst is 3: the fourth throw inside 4.5 s -> 429 Slow down with Retry-After', fourth.status === 429 && fourth.data.error === 'Slow down' && Number(fourth.res.headers.get('retry-after')) >= 1, fourth)
  r = await sendAs(g2, u2, T)
  check('another participant has their own budget', r.status === 200, r)
  await patch(vb, owner.jar, { locked: true })
  r = await sendAs(g2, u2, T)
  check('a locked board refuses guests throws -> 403 Board is read-only', r.status === 403 && r.data.error === 'Board is read-only', r)
  const ownerUid = (await get(vb, owner.jar)).data.viewer.uid
  r = await sendAs(owner.jar, ownerUid, T)
  check('the owner may still throw on a locked board', r.status === 200, r)
  await patch(vb, owner.jar, { locked: false })

  // passcode through PATCH
  r = await get(vb, owner.jar)
  check('hasPasscode is false before one is set', r.data.board.hasPasscode === false, r.data.board.hasPasscode)
  const revP = r.data.board.rev
  r = await patch(vb, owner.jar, { passcode: 'letmein-7B' })
  check('PATCH passcode set -> hasPasscode true, rev +1, and no hash or passcode in the answer', r.status === 200 && r.data.board.hasPasscode === true && r.data.board.rev === revP + 1 && !JSON.stringify(r.data).includes('letmein-7B') && !('passcodeHash' in r.data.board), r.data.board)
  check('a fresh guest is now asked for the passcode', (await get(vb, new Jar())).status === 401)
  r = await patch(vb, owner.jar, { passcode: null })
  check('PATCH passcode null clears it -> hasPasscode false, rev +1', r.status === 200 && r.data.board.hasPasscode === false && r.data.board.rev === revP + 2, r.data.board)
  check('and a fresh guest is let in again', (await get(vb, new Jar())).status === 200)
  r = await call('GET', `/api/boards/${vb}/since?t=0`)
  check('the guest-safe board carries hasPasscode (a boolean) but never the hash', r.data.board.hasPasscode === false && !('passcodeHash' in r.data.board), r.data.board)
}

// ---------------------------------------------------------------- Task 8: celebration cards, recipient and reveal
{
  const cb = (await mk(ann.jar, { type: 'celebration', template: 'birthday', title: 'For Sam', recipient: { name: 'Sam Rivera' } })).data.code
  const friend = new Jar()
  const stranger = new Jar()
  await as(cb, friend)
  await as(cb, stranger)
  const card = (id, over = {}) => ({ op: 'add', item: { id, kind: 'card', x: 0, y: 220, w: 300, h: 200, data: { message: `Message ${id}`, signer: 'Alex', color: 'pink', ...over } } })
  r = await ops(cb, friend, [card('card-1', { gif: 'https://media.giphy.com/media/x/200.gif', mediaW: 356, mediaH: 200 })])
  check('a guest can add a valid card (message, signer, colour, https GIF with its size)', r.status === 200 && r.data.applied.length === 1 && r.data.applied[0].data.gif.startsWith('https://') && r.data.applied[0].authorName.length > 0, r)
  r = await ops(cb, friend, [
    card('bad-gif', { gif: 'javascript:alert(1)' }),
    card('bad-img', { image: `data:image/png;base64,${'A'.repeat(600 * 1024)}` }),
    card('bad-long', { message: 'x'.repeat(501) }),
    card('bad-empty', { message: '   ' }),
    card('bad-signer', { signer: '' }),
    card('bad-signer-long', { signer: 's'.repeat(41) }),
    card('bad-color', { color: 'red' }),
    card('bad-http-gif', { gif: 'http://media.giphy.com/media/x/200.gif' }),
    card('bad-size', { gif: 'https://media.giphy.com/media/x/200.gif', mediaW: 0, mediaH: 200 }),
  ])
  check('a javascript: or http: GIF, an oversized photo, a 501-char message, a blank message, a bad signer, colour or size are all rejected', r.status === 200 && r.data.applied.length === 0 && r.data.rejected.length === 9, r.data)
  r = await ops(cb, friend, [{ op: 'update', id: 'card-1', patch: { data: { message: '' } } }])
  check('an update that blanks a card message is rejected', r.data.applied.length === 0 && r.data.rejected.length === 1, r.data)
  r = await ops(cb, stranger, [{ op: 'update', id: 'card-1', patch: { data: { message: 'hijack' } } }])
  check('another guest cannot edit a card they did not write', r.data.applied.length === 0, r.data)
  r = await ops(cb, ann.jar, [{ op: 'update', id: 'card-1', patch: { data: { message: 'Moderated by the owner' } } }])
  check('the owner can edit any card', r.data.applied.length === 1 && r.data.applied[0].data.message === 'Moderated by the owner', r.data)

  // read-only guests
  await patch(cb, ann.jar, { locked: true })
  r = await ops(cb, friend, [card('card-locked')])
  check('a guest cannot add a card on a locked board', r.data.applied.length === 0 && r.data.rejected[0]?.error === 'Board is locked', r.data)
  await patch(cb, ann.jar, { locked: false, status: 'closed' })
  r = await ops(cb, friend, [card('card-closed')])
  check('a guest cannot add a card on a closed board -> 403', r.status === 403, r)
  r = await ops(cb, ann.jar, [card('card-owner')])
  check('the owner can add cards on a closed board', r.data.applied.length === 1, r.data)
  await patch(cb, ann.jar, { status: 'open' })

  // recipient and revealAt through PATCH
  r = await patch(cb, ann.jar, { recipient: { name: 'Sam R.' }, revealAt: '2031-01-01T10:00:00.000Z' })
  check('PATCH recipient + revealAt (ISO) -> 200 and echoed', r.status === 200 && r.data.board.recipient.name === 'Sam R.' && r.data.board.revealAt === '2031-01-01T10:00:00.000Z', r)
  const badDates = ['tomorrow', '1', '', '2031-02-31T10:00:00Z', '2031-01-01', 1893492000000]
  const badStatuses = []
  for (const bad of badDates) badStatuses.push((await patch(cb, ann.jar, { revealAt: bad })).status)
  check('PATCH revealAt with garbage, an empty string, a rolled-over day, a bare date or a number -> 400 every time', badStatuses.every((st) => st === 400), badStatuses)
  r = await patch(cb, ann.jar, { recipient: { name: 'n'.repeat(61) } })
  check('PATCH recipient over 60 characters -> 400', r.status === 400, r)
  r = await patch(cb, ann.jar, { recipient: { name: '  ' } })
  check('PATCH recipient with a blank name -> 400', r.status === 400, r)
  r = await patch(cb, guest, { revealAt: null })
  check('PATCH revealAt by a non-owner -> 401/403', r.status === 401 || r.status === 403, r)

  // the reveal route
  const reveal = (jar, t) => call('GET', `/api/boards/${cb}/reveal${t === undefined ? '' : `?t=${t}`}`, undefined, { jar })
  r = await reveal(new Jar())
  check('reveal before the time: sealed, the board but NO items key, and no card text anywhere in the answer', r.status === 200 && r.data.sealed === true && !('items' in r.data) && r.data.board.recipient.name === 'Sam R.' && !JSON.stringify(r.data).includes('Moderated by the owner') && !('ownerId' in r.data.board), r.data)
  check('reveal mints no guest cookie (a read-only view has no identity)', r.setCookies.length === 0, r.setCookies)
  check('the sealed answer carries no updatedAt or lastTs (no activity timing)', !('updatedAt' in r.data.board) && !('lastTs' in r.data.board), Object.keys(r.data.board))
  const sealedT = await reveal(new Jar(), 0)
  check('reveal?t=0 while sealed is still sealed: no items key, no card text', sealedT.status === 200 && sealedT.data.sealed === true && !('items' in sealedT.data) && !JSON.stringify(sealedT.data).includes('Moderated by the owner'), sealedT.data)
  const sealedSince = await call('GET', `/api/boards/${cb}/since?t=0`)
  const sealedSnap = await get(cb, new Jar())
  check('ACCEPTED LIMIT: before the reveal /since and the snapshot still return the cards (the code is the only secret; the reveal page is a nicety)', sealedSince.data.items.some((i) => i.id === 'card-1') && sealedSnap.data.items.some((i) => i.id === 'card-1'), { since: sealedSince.status, snap: sealedSnap.status })
  r = await reveal(ann.jar)
  check('reveal as the owner previews: not sealed, cards included', r.data.role === 'owner' && r.data.sealed === false && r.data.items.some((i) => i.id === 'card-1'), r.data)
  await patch(cb, ann.jar, { revealAt: new Date(Date.now() - 1000).toISOString() })
  r = await reveal(new Jar())
  check('reveal after the time: cards (and only cards) are returned', r.data.sealed === false && r.data.items.length >= 2 && r.data.items.every((i) => i.kind === 'card') && !JSON.stringify(r.data).includes('Happy Birthday'), r.data)
  r = await reveal(new Jar(), Math.max(...r.data.items.map((i) => i.updatedAt)))
  check('reveal?t=<newest> -> nothing new', r.status === 200 && r.data.items.length === 0, r.data)
  check('reveal?t=abc -> 400, unknown board -> 404', (await reveal(new Jar(), 'abc')).status === 400 && (await call('GET', '/api/boards/ZZZZZZ/reveal')).status === 404)
  await patch(cb, ann.jar, { revealAt: null, passcode: 'reveal-pass' })
  r = await reveal(new Jar())
  check('reveal on a passcode board without the cookie -> 401 Passcode required', r.status === 401 && r.data.error === 'Passcode required', r)
  await patch(cb, ann.jar, { passcode: null })
}

// ---------------------------------------------------------------- Task 16: retro boards, AI settings, summaries
// Needs no provider for most of it. With a development server started with AI_FAKE=1 the generation checks run too
// (the owner snapshot says so in viewer.ai.configured); on a server with no AI they check the 503 instead.
{
  const TEMPLATES = {
    'retro-wwci': ['✅ Went Well', '⚠️ Could Be Improved', '🚧 Blockers', '💡 Ideas'],
    'retro-ssc': ['Start', 'Stop', 'Continue'],
    'retro-msg': ['Mad', 'Sad', 'Glad'],
  }
  for (const [template, titles] of Object.entries(TEMPLATES)) {
    const made = await mk(ann.jar, { type: 'retro', template, title: 'Sprint 12', recipient: { name: 'Ignored' } })
    const snap = await get(made.data.code, new Jar())
    const frames = snap.data.items.filter((i) => i.kind === 'frame').sort((a, b) => a.x - b.x)
    check(`retro ${template}: created, the starter columns carry the right titles left to right, no recipient, nothing AI in the guest view`,
      made.status === 200 && snap.data.board.type === 'retro' && snap.data.board.recipient === null && JSON.stringify(frames.map((f) => f.data.title)) === JSON.stringify(titles)
        && frames.every((f, i) => f.x === i * 384 && f.y === 140 && f.w === 360 && f.h === 640) && snap.data.items.some((i) => i.id === 'starter-header' && i.data.text === 'Add notes to each column, then vote.')
        && !('ai' in snap.data.board) && snap.data.board.summary === null && snap.data.board.summaryState === 'idle', { made, board: snap.data.board })
  }
  r = await mk(ann.jar, { type: 'retro', template: 'retro', title: 'x' })
  check('a workshop template key under type retro -> 400', r.status === 400, r)

  const rb = (await mk(ann.jar, { type: 'retro', template: 'retro-wwci', title: 'Retro with AI' })).data.code
  const rGuest = new Jar()
  await as(rb, rGuest)
  const ownerSnap = await get(rb, ann.jar)
  const configured = ownerSnap.data.viewer.ai?.configured === true
  check('owner snapshot: AI settings off by default, viewer.ai says whether the server can write summaries and with which model; a guest gets neither',
    JSON.stringify(ownerSnap.data.board.ai) === JSON.stringify({ enabled: false, ackAt: null, autoSummary: false, autoShare: false }) && typeof ownerSnap.data.viewer.ai?.model === 'string' && !('ai' in (await get(rb, rGuest)).data.viewer), ownerSnap.data.viewer)

  // the AI settings through PATCH
  r = await patch(rb, ann.jar, { ai: { enabled: true } })
  check('turning AI on without ack:true -> 400, and nothing changed', r.status === 400 && /understand/.test(r.data.error) && (await get(rb, ann.jar)).data.board.ai.enabled === false, r)
  for (const bad of [{ ai: { autoSummary: true } }, { ai: { enabled: 'yes', ack: true } }, { ai: { enabled: true, ack: true, model: 'x' } }, { ai: {} }, { ai: [] }, { summary: { status: 'published' } }, { summary: { text: 'x'.repeat(4001) } }, { summary: { text: '' } }, { summary: { source: 'manual', text: 'a' } }])
    check(`PATCH ${JSON.stringify(bad).slice(0, 60)} -> 400`, (await patch(rb, ann.jar, bad)).status === 400)
  r = await patch(rb, guest, { ai: { enabled: true, ack: true } })
  check('a guest cannot change AI settings (401/403)', r.status === 401 || r.status === 403, r)
  r = await patch(rb, bobAcct.jar, { ai: { enabled: true, ack: true } })
  check('another account cannot change AI settings (403)', r.status === 403, r)

  // summary routes before AI is on
  const sum = (jar, method = 'POST', body = {}) => call(method, `/api/boards/${rb}/summary`, method === 'GET' ? undefined : body, { jar })
  r = await sum(ann.jar)
  check('POST summary with AI off -> 403 "AI is off for this board"', r.status === 403 && r.data.error === 'AI is off for this board', r)
  check('POST summary: no session 401, a guest 401, another account 403; GET the same', (await sum(new Jar())).status === 401 && (await sum(rGuest)).status === 401 && (await sum(bobAcct.jar)).status === 403
    && (await sum(new Jar(), 'GET')).status === 401 && (await sum(rGuest, 'GET')).status === 401 && (await sum(bobAcct.jar, 'GET')).status === 403)
  r = await call('POST', `/api/boards/${rb}/summary`, {}, { jar: ann.jar, headers: { origin: 'http://evil.example' } })
  check('POST summary with a cross-origin Origin -> 403; text/plain -> 415', r.status === 403 && (await call('POST', `/api/boards/${rb}/summary`, undefined, { jar: ann.jar, raw: '{}', headers: { 'content-type': 'text/plain' }, json: false })).status === 415, r)

  r = await patch(rb, ann.jar, { ai: { enabled: true, ack: true } })
  check('turning AI on with ack:true -> 200 with ackAt set', r.status === 200 && r.data.board.ai.enabled === true && typeof r.data.board.ai.ackAt === 'number', r.data.board?.ai)
  r = await sum(ann.jar)
  if (configured) check('POST summary on a board with nothing on it -> 409 "Nothing to summarise yet"', r.status === 409 && r.data.error === 'Nothing to summarise yet', r)
  else check('POST summary on a server with no AI -> 503 "AI isn\'t set up on this server"', r.status === 503 && r.data.error === "AI isn't set up on this server", r)

  // a hand-written summary needs no provider; its draft never reaches a guest on any route
  const SECRET = `Manual draft ${rnd()}`
  await ops(rb, rGuest, [{ op: 'add', item: { id: 'n1', kind: 'note', x: 40, y: 200, w: 200, h: 120, data: { text: 'Pairing helped' } } }])
  r = await patch(rb, ann.jar, { summary: { text: SECRET } })
  check('owner writes a summary by hand: a draft, source manual, no model', r.status === 200 && r.data.board.summary.status === 'draft' && r.data.board.summary.source === 'manual' && r.data.board.summary.model === null, r.data.board?.summary)
  const guestViews = async () => [
    await get(rb, rGuest), await get(rb, new Jar()),
    await call('GET', `/api/boards/${rb}/since?t=0`), await call('GET', `/api/boards/${rb}/reveal`, undefined, { jar: rGuest }), await call('GET', `/api/boards/${rb}/reveal?t=0`),
  ]
  let views = await guestViews()
  check('the DRAFT is in no guest response: snapshot, anonymous snapshot, /since, /reveal, /reveal?t=0', views.every((v) => v.status === 200 && !JSON.stringify(v.data).includes(SECRET) && v.data.board.summary === null && !('ai' in v.data.board)), views.map((v) => v.status))
  r = await get(rb, ann.jar)
  check('the owner sees the draft in the snapshot, and GET summary returns it', r.data.board.summary.text === SECRET && (await sum(ann.jar, 'GET')).data.summary.text === SECRET)
  r = await call('GET', '/api/my-boards', undefined, { jar: ann.jar })
  check('my-boards says a summary exists but does not carry its text', !JSON.stringify(r.data).includes(SECRET) && r.data.boards.find((b) => b.code === rb).hasSummary === true)
  r = await patch(rb, rGuest, { summary: { status: 'shared' } })
  check('a guest cannot share a summary (401/403)', r.status === 401 || r.status === 403, r)
  r = await patch(rb, ann.jar, { summary: { status: 'shared' } })
  views = await guestViews()
  check('shared: every guest route carries it with its source and edit mark, and no model or generation time', r.status === 200 && views.every((v) => JSON.stringify(Object.keys(v.data.board.summary)) === '["text","status","source","editedAt"]' && v.data.board.summary.text === SECRET && v.data.board.summary.status === 'shared' && v.data.board.summary.source === 'manual' && typeof v.data.board.summary.editedAt === 'number'), views.map((v) => v.data.board.summary))
  r = await patch(rb, ann.jar, { summary: { text: `${SECRET} (edited)` } })
  check('editing the text sets editedAt and the guests see the new text', r.status === 200 && typeof r.data.board.summary.editedAt === 'number' && (await get(rb, rGuest)).data.board.summary.text.endsWith('(edited)'), r.data.board?.summary)
  await patch(rb, ann.jar, { summary: { status: 'draft' } })
  views = await guestViews()
  check('Make private: gone from every guest route again', views.every((v) => !JSON.stringify(v.data).includes(SECRET) && v.data.board.summary === null))
  r = await patch(rb, ann.jar, { summary: null })
  check('PATCH summary:null deletes it', r.status === 200 && r.data.board.summary === null && (await get(rb, ann.jar)).data.board.summary === null)

  if (!configured) {
    check('AI_FAKE not set on this server: the generation checks are skipped (the unit tests cover them with a stubbed provider)', true)
  } else {
    // generation with the development fake: a draft nobody else can see, one writer at a time, then shared
    const [a, b] = await Promise.all([sum(ann.jar), (async () => { await new Promise((res) => setTimeout(res, 150)); return sum(ann.jar) })()])
    const ok = a.status === 200 ? a : b
    const busy = a.status === 200 ? b : a
    check('two presses at once: one writes a draft (source ai, model fake), the other is 409 "Already writing"', ok.status === 200 && ok.data.summary.status === 'draft' && ok.data.summary.source === 'ai' && ok.data.summary.model === 'fake' && busy.status === 409 && busy.data.error === 'Already writing', { a: a.status, b: b.status })
    views = await guestViews()
    check('the generated draft is in no guest response', views.every((v) => !JSON.stringify(v.data).includes(ok.data.summary.text) && v.data.board.summary === null))
    const slow = sum(ann.jar)
    await new Promise((res) => setTimeout(res, 300))
    check('while it writes, guests and the owner see summaryState "generating" and nothing else', (await get(rb, rGuest)).data.board.summaryState === 'generating' && (await sum(ann.jar, 'GET')).data.summaryState === 'generating')
    await slow
    check('afterwards the state is idle again', (await get(rb, rGuest)).data.board.summaryState === 'idle' && (await sum(ann.jar, 'GET')).data.summaryState === 'idle')
    await patch(rb, ann.jar, { summary: { status: 'shared' } })
    check('after Share the guest sees the AI-generated summary, labelled by source ai, with no model', (await get(rb, rGuest)).data.board.summary?.source === 'ai' && !('model' in (await get(rb, rGuest)).data.board.summary))
    await patch(rb, ann.jar, { summary: null })

    // closing with automatic summary + autoShare writes ONE shared summary in the background
    await patch(rb, ann.jar, { ai: { autoSummary: true, autoShare: true } })
    r = await patch(rb, ann.jar, { status: 'closed' })
    check('closing answers at once, with the summary still being written', r.status === 200 && r.data.board.status === 'closed' && r.data.board.summaryState === 'generating' && r.data.board.summary === null, r.data.board)
    let shared = null
    for (let i = 0; i < 30 && !shared; i++) { await new Promise((res) => setTimeout(res, 300)); shared = (await get(rb, rGuest)).data.board.summary }
    check('the automatic summary arrives shared and labelled source ai', shared?.status === 'shared' && shared.source === 'ai', shared)
    const first = shared.text
    await patch(rb, ann.jar, { status: 'closed' })
    await new Promise((res) => setTimeout(res, 2500))
    check('closing again does not write another one', (await sum(ann.jar, 'GET')).data.summary.text === first && (await sum(ann.jar, 'GET')).data.summaryState === 'idle')

    // the sixth summary on one board within the hour is refused
    const lim = (await mk(ann.jar, { type: 'retro', template: 'retro-ssc', title: 'Limit' })).data.code
    await patch(lim, ann.jar, { ai: { enabled: true, ack: true } })
    await ops(lim, ann.jar, [{ op: 'add', item: { id: 'n1', kind: 'note', x: 40, y: 200, w: 200, h: 120, data: { text: 'something' } } }])
    const codes = []
    for (let i = 0; i < 6; i++) codes.push((await call('POST', `/api/boards/${lim}/summary`, {}, { jar: ann.jar })).status)
    check('5 summaries are fine, the 6th within the hour is 429', JSON.stringify(codes) === '[200,200,200,200,200,429]', codes)
  }
}

// ---------------------------------------------------------------- nothing sensitive in any response
const leaks = ['passcodeHash', 'ownerKeyHash', 'passwordHash', 'scrypt$', 'open sesame', 'a brand new one', 'passcode-B', 'limit-test-1', PASSWORD]
const leaked = leaks.filter((needle) => bodies.some((b) => b.includes(needle)))
check('no response from any route contains a hash field, scrypt$ or a plaintext passcode', leaked.length === 0, leaked)

console.log(`\nall ${n} checks passed against ${BASE}`)
