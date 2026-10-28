// Black-box simulation of participant personas and the server-minted guest identity (rs_g).
// Usage: node scripts/sim-persona.mjs [baseUrl]  (default http://localhost:3000)
// Start a FRESH dev server first (blanked env): rate-limit counters live in the server process.
// Split from sim-api.mjs, which covers boards, ops, passcodes and limits. Exits non-zero on the first failed assertion.
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`

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
}

// Every request gets its own x-forwarded-for, so rate-limit budgets never interfere.
async function call(method, path, body, { jar, raw, headers = {}, json = true } = {}) {
  const h = { 'x-forwarded-for': fakeIp(), ...headers }
  if (json && (body !== undefined || raw !== undefined)) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' })
  const text = await res.text()
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
  const setCookies = res.headers.getSetCookie()
  for (const c of setCookies) if (c.startsWith('rs_g=')) rawUids.add(c.slice(5).split(';')[0].split('.')[0])
  jar?.absorb(setCookies)
  return { status: res.status, data, res, setCookies }
}

const bodies = []
const rawUids = new Set() // private cookie uids handed out; none may appear in a response body
const rawOf = (jar) => jar.get('rs_g').split('.')[0] // the PRIVATE cookie uid of a browser
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
  const r = await call('POST', '/api/auth/register', { email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' }, { jar })
  if (r.status !== 200) { console.log('FAIL could not register', name, r.status, r.data); process.exit(1) }
  return { jar, id: r.data.user.id }
}

const note = (id, text = 'hi') => ({ op: 'add', item: { id, kind: 'note', x: 10, y: 20, w: 200, h: 200, data: { text } } })
const get = (code, jar) => call('GET', `/api/boards/${code}`, undefined, { jar })
const ops = (code, jar, list, extra = {}) => call('POST', `/api/boards/${code}/ops`, { ops: list, ...extra }, { jar })
const patch = (code, jar, p) => call('PATCH', `/api/boards/${code}`, { patch: p }, { jar })
const putPersona = (code, jar, persona, extra = {}) => call('PUT', `/api/boards/${code}/persona`, { persona, ...extra }, { jar })
// A browser that has opened the board and chosen a persona: the snapshot mints its rs_g cookie into the jar.
async function as(code, jar, persona = generatePersona()) {
  const snap = await get(code, jar)
  if (snap.status !== 200) return null
  if (!snap.data.viewer.persona) {
    const put = await putPersona(code, jar, persona)
    if (put.status !== 200) { console.log('FAIL could not choose a persona', put.status, put.data); process.exit(1) }
  }
  return snap.data.viewer.uid
}

const carol = await account('carol')
let r

const pb = await call('POST', '/api/boards', { type: 'workshop', template: 'retro', title: 'Personas' }, { jar: carol.jar })
const pcode = pb.data.code
const lock = (c) => patch(pcode, carol.jar, c)
await patch(pcode, carol.jar, { vote: { active: true, perPerson: 3 } }) // votes are refused while voting is closed
const fresh = () => new Jar()
const AVATAR = { bg: 3, body: 1, eyes: 2, mouth: 5, extra: 0 }

// the cookie
const j1 = fresh()
const first = await get(pcode, j1)
const rsg = first.setCookies.find((c) => c.startsWith('rs_g=')) || ''
const rsgAttrs = rsg.split(';').map((x) => x.trim())
check('the snapshot mints rs_g: signed <uid>.<hmac>, HttpOnly, SameSite=Lax, Path=/, one year', /^rs_g=KM-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}\.[0-9a-f]{32}$/.test(rsgAttrs[0]) && ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000'].every((f) => rsgAttrs.includes(f)), rsgAttrs.slice(1))
check('viewer = { role, uid, persona: null }; the uid is the board\'s PUBLIC id, not the cookie\'s private one; participants lists only people who chose a name', first.data.viewer.persona === null && /^KM-/.test(first.data.viewer.uid) && first.data.viewer.uid !== rawOf(j1) && first.data.participants.every((p) => p.uid !== first.data.viewer.uid) && Object.keys(first.data.viewer).sort().join() === 'persona,role,uid', first.data.viewer)
const again = await get(pcode, j1)
check('a valid cookie is kept: the second snapshot sets no new one and shows the same uid', again.setCookies.every((c) => !c.startsWith('rs_g=')) && again.data.viewer.uid === first.data.viewer.uid)
const forgedJar = fresh(); forgedJar.m.set('rs_g', `${rawOf(j1)}.${'0'.repeat(32)}`)
const replaced = await get(pcode, forgedJar)
check('a forged cookie (right uid, wrong hmac) is replaced with a new identity, never honoured', replaced.setCookies.some((c) => c.startsWith('rs_g=')) && replaced.data.viewer.uid !== first.data.viewer.uid, replaced.data.viewer)

// nothing works without a persona
r = await ops(pcode, j1, [note('too-early')])
check('ops before choosing a name -> 409 Choose a name first', r.status === 409 && r.data.error === 'Choose a name first', r)
r = await call('POST', '/api/rt/join', { code: pcode }, { jar: j1 })
check('rt join before choosing a name -> 409 Choose a name first', r.status === 409 && r.data.error === 'Choose a name first', r)
r = await call('POST', '/api/rt/join', { code: pcode }, { jar: fresh() })
check('rt join with no guest cookie -> 401 Join the board first', r.status === 401 && r.data.error === 'Join the board first', r)
r = await putPersona(pcode, fresh(), generatePersona())
check('PUT persona with no guest cookie -> 401 Join the board first', r.status === 401 && r.data.error === 'Join the board first', r)

// choosing
const mine = generatePersona(Math.random, new Set())
r = await putPersona(pcode, j1, { ...mine, avatar: AVATAR })
check('PUT persona (anonymous, from the word lists) -> 200 and { persona } only', r.status === 200 && JSON.stringify(Object.keys(r.data)) === '["persona"]' && r.data.persona.name === mine.name && r.data.persona.kind === 'anonymous', r)
r = await get(pcode, j1)
check('the snapshot now shows my persona as viewer.persona and in participants (uid, name, avatar, kind only)', r.data.viewer.persona.name === mine.name && JSON.stringify(r.data.participants.find((p) => p.uid === again.data.viewer.uid)) === JSON.stringify({ uid: again.data.viewer.uid, name: mine.name, avatar: AVATAR, kind: 'anonymous' }), r.data.participants)
r = await call('POST', '/api/rt/join', { code: pcode, uid: 'KM-2222-2222-2222' }, { jar: j1 })
check('rt join with a persona -> 200 and a token (a body uid is ignored)', r.status === 200 && /^\d+\.[0-9a-f]{32}$/.test(r.data.tok), r)

// validation
const j2 = fresh(); await get(pcode, j2)
const tryName = (name, kind = 'custom') => putPersona(pcode, j2, { kind, name, avatar: AVATAR })
r = await tryName('Call me on 555-0100', 'anonymous')
check('free text cannot pass as an anonymous name -> 400', r.status === 400, r)
r = await tryName(mine.name.toUpperCase())
check('a custom name that differs only by case from a taken one -> 409', r.status === 409 && /taken/i.test(r.data.error), r)
r = await tryName('  ' + mine.name.toLowerCase().replace(' ', '   ') + ' ')
check('and so does one that differs only by spacing', r.status === 409, r)
r = await tryName('CAROL')
check('the board owner\'s display name is a 409 for everyone else', r.status === 409, r)
check('a name with no letter or digit -> 400', (await tryName('🎉🎉')).status === 400 && (await tryName('--')).status === 400)
check('a name of 1 or 25 characters -> 400', (await tryName('A')).status === 400 && (await tryName('x'.repeat(25))).status === 400)
r = await putPersona(pcode, j2, { kind: 'custom', name: 'Zed', avatar: { ...AVATAR, bg: 12 } })
check('an out-of-range avatar part -> 400', r.status === 400, r)
r = await putPersona(pcode, j2, { kind: 'custom', name: 'Zed', avatar: { ...AVATAR, hat: 1 } })
check('an extra avatar key -> 400', r.status === 400, r)
r = await tryName('Carol', 'account')
check('only the owner may use the account kind -> 400', r.status === 400, r)
r = await putPersona(pcode, j2, { kind: 'anonymous', name: mine.name, avatar: AVATAR })
check('a taken anonymous name -> 409 with a fresh suggestion', r.status === 409 && typeof r.data.suggestion === 'string' && r.data.suggestion.toLowerCase() !== mine.name.toLowerCase(), r)
const suggestion = r.data.suggestion
r = await putPersona(pcode, j2, { kind: 'anonymous', name: suggestion, avatar: AVATAR })
check('adopting the suggestion works', r.status === 200 && r.data.persona.name === suggestion, r)
r = await putPersona(pcode, j2, { kind: 'custom', name: '  Zoë\u0000   Kim  ', avatar: AVATAR })
check('a custom name is cleaned (control characters, runs of spaces) and stored', r.status === 200 && r.data.persona.name === 'Zoë Kim' && r.data.persona.kind === 'custom', r)

// identity comes from the cookie only
const j3 = fresh(); const uid3 = await as(pcode, j3, { kind: 'custom', name: 'Mallory', avatar: AVATAR })
const victim = await get(pcode, j2)
const victimUid = victim.data.viewer.uid
r = await putPersona(pcode, j3, { kind: 'custom', name: 'Mallory Two', avatar: AVATAR }, { uid: victimUid })
check('PUT persona with the victim\'s uid in the body changes only my own persona', r.status === 200 && (await get(pcode, j2)).data.viewer.persona.name === 'Zoë Kim' && (await get(pcode, j3)).data.viewer.persona.name === 'Mallory Two', r)
r = await ops(pcode, j2, [note('v-note', 'victim note')], { uid: uid3, name: 'Mallory', avatar: { bg: 0, body: 0, eyes: 0, mouth: 0, extra: 0 } })
const stamped = r.data.applied?.[0]
check('ops ignores uid / name / avatar in the body: the item carries the cookie uid and the stored persona', r.status === 200 && stamped?.authorUid === victimUid && stamped?.authorName === 'Zoë Kim' && JSON.stringify(stamped?.authorAvatar) === JSON.stringify(AVATAR), stamped)
for (const [label, body] of [['update', { op: 'update', id: 'v-note', patch: { data: { text: 'hacked' } } }], ['delete', { op: 'delete', id: 'v-note' }]]) {
  r = await ops(pcode, j3, [body], { uid: victimUid, name: 'Zoë Kim' })
  check(`guest B cannot ${label} guest A's note even when the body claims A's uid`, r.status === 200 && r.data.applied.length === 0 && r.data.rejected[0]?.error === 'Not allowed', r)
}
r = await call('POST', `/api/boards/${pcode}/ops?uid=${victimUid}`, { ops: [{ op: 'delete', id: 'v-note' }], uid: victimUid }, { jar: j3 })
check('...nor with the uid in the query string as well', r.status === 200 && r.data.applied.length === 0, r)
const spliced = fresh(); spliced.m.set('rs_g', `${rawOf(j2)}.${j3.get('rs_g').split('.')[1]}`)
r = await ops(pcode, spliced, [{ op: 'delete', id: 'v-note' }], { uid: victimUid })
check('A\'s uid with B\'s hmac is no identity -> 401 Join the board first', r.status === 401 && r.data.error === 'Join the board first', r)
const bare = fresh(); bare.m.set('rs_g', rawOf(j2))
r = await ops(pcode, bare, [{ op: 'delete', id: 'v-note' }], { uid: victimUid })
check('A\'s uid alone as the cookie is no identity either -> 401', r.status === 401, r)
const oldStyle = fresh(); oldStyle.m.set('km_uid', rawOf(j2))
r = await ops(pcode, oldStyle, [{ op: 'delete', id: 'v-note' }], { uid: victimUid })
check('the old client-set km_uid cookie proves nothing -> 401', r.status === 401, r)
r = await ops(pcode, j3, [{ op: 'vote', id: 'v-note' }], { uid: victimUid })
check('a vote is recorded under the cookie uid, not the body uid', r.data.applied[0]?.votes?.join() === uid3, r.data.applied?.[0]?.votes)
check('the note is untouched', (await get(pcode, j2)).data.items.find((i) => i.id === 'v-note')?.data.text === 'victim note')

// fixed once used
r = await putPersona(pcode, j2, { kind: 'custom', name: 'Zoë Again', avatar: AVATAR })
check('a persona is fixed once its owner has added something -> 403', r.status === 403 && r.data.error === 'Persona is fixed once you have added something', r)
check('...and the stored persona did not change', (await get(pcode, j2)).data.viewer.persona.name === 'Zoë Kim')
r = await putPersona(pcode, j1, { kind: 'custom', name: 'Changed Before', avatar: AVATAR })
check('someone who has added nothing may still change theirs', r.status === 200 && r.data.persona.name === 'Changed Before', r)

// owner
const o = await get(pcode, carol.jar)
check('the owner gets an account persona (account name, derived avatar) on the first snapshot, without choosing', o.data.viewer.persona?.kind === 'account' && o.data.viewer.persona.name === 'carol' && Object.keys(o.data.viewer.persona.avatar).length === 5, o.data.viewer.persona)
check('a snapshot never shows an email or a user id inside participants', !JSON.stringify(o.data.participants).includes('@') && !JSON.stringify(o.data.participants).includes(carol.id), o.data.participants)
check('the starter items carry the owner\'s account name', o.data.items.filter((i) => i.authorUid === o.data.viewer.uid).length === 3 && o.data.items.filter((i) => i.authorUid === o.data.viewer.uid).every((i) => i.authorName === 'carol'), o.data.items.map((i) => [i.authorUid === o.data.viewer.uid, i.authorName]))
r = await putPersona(pcode, carol.jar, { kind: 'account', name: 'ignored', avatar: { bg: 9, body: 7, eyes: 1, mouth: 1, extra: 1 } })
check('the owner may change the avatar even after the starter items (the name stays the account name)', r.status === 200 && r.data.persona.name === 'carol' && r.data.persona.avatar.bg === 9, r)

// hourly budget
const j4 = fresh(); await get(pcode, j4)
const codes = []
for (let i = 0; i < 11; i++) codes.push((await putPersona(pcode, j4, { kind: 'custom', name: `Budget ${i}`, avatar: AVATAR })).status)
check('persona changes: 10 an hour per guest, the 11th -> 429', codes.slice(0, 10).every((c) => c === 200) && codes[10] === 429, codes)

// closed board
await lock({ status: 'closed' })
const late = fresh(); await get(pcode, late)
r = await putPersona(pcode, late, generatePersona())
check('closed board: a new guest cannot choose a persona -> 403 Board is closed', r.status === 403 && r.data.error === 'Board is closed', r)
check('closed board: reading is still fine', (await get(pcode, late)).status === 200)
r = await putPersona(pcode, carol.jar, { kind: 'account', name: 'x', avatar: AVATAR })
check('closed board: the owner can still change their avatar', r.status === 200, r)
await lock({ status: 'open' })

// unlinkable across boards
const other = await call('POST', '/api/boards', { type: 'workshop', template: 'blank', title: 'Second board' }, { jar: carol.jar })
const j5 = fresh(); const idHere = await as(pcode, j5, { kind: 'custom', name: 'Roamer', avatar: AVATAR })
const there = await get(other.data.code, j5)
check('the same browser has an unrelated id on another board (nothing links the two), stable on each', there.data.viewer.uid !== idHere && (await get(pcode, j5)).data.viewer.uid === idHere && there.data.viewer.persona === null, [idHere, there.data.viewer.uid])
r = await ops(other.data.code, j5, [note('cross')], { uid: idHere, name: 'Roamer' })
check('naming the id from board A on board B gets nothing: the guest has to choose a name there first', r.status === 409 && r.data.error === 'Choose a name first', r)
check('no response so far contains a private cookie uid', rawUids.size > 5 && [...rawUids].every((raw) => bodies.every((b) => !b.includes(raw))), rawUids.size)

// owner: identified by the account, on every browser
const jOwnerA = carol.jar
const jOwnerB = fresh(); jOwnerB.m.set('rs_session', carol.jar.get('rs_session'))
const ownerA = await get(pcode, jOwnerA)
const ownerB = await get(pcode, jOwnerB)
const ownerStarter = ownerA.data.items.find((i) => i.authorUid === ownerA.data.viewer.uid).id
check('the owner has the same id and persona on a second browser (two cookie jars, one session)', ownerA.data.viewer.uid === ownerB.data.viewer.uid && ownerB.data.viewer.persona?.kind === 'account' && rawOf(jOwnerA) !== rawOf(jOwnerB), [ownerA.data.viewer.uid, ownerB.data.viewer.uid])
check('and appears once in the participants list', ownerB.data.participants.filter((p) => p.kind === 'account').length === 1)
const noCookieOwner = fresh(); noCookieOwner.m.set('rs_session', carol.jar.get('rs_session'))
r = await ops(pcode, noCookieOwner, [note('owner-session-only')])
check('the owner can write with the session alone (no guest cookie)', r.status === 200 && r.data.applied[0]?.authorUid === ownerA.data.viewer.uid, r)

// sign-out leaves the guest cookie; the next person is a guest on that browser
const out = await call('POST', '/api/auth/logout', {}, { jar: carol.jar })
check('signing out ends the session but leaves the browser\'s guest identity cookie alone', out.status === 200 && out.setCookies.some((c) => c.startsWith('rs_session=')) && !out.setCookies.some((c) => c.startsWith('rs_g=')) && carol.jar.has('rs_g'), out.setCookies)
const afterOut = await get(pcode, carol.jar)
check('after sign-out the same browser is a guest with no persona (the chooser), not the owner', afterOut.data.viewer.role === 'guest' && afterOut.data.viewer.persona === null && afterOut.data.viewer.uid !== ownerA.data.viewer.uid, afterOut.data.viewer)
r = await ops(pcode, carol.jar, [{ op: 'update', id: ownerStarter, patch: { x: 5 } }, { op: 'delete', id: ownerStarter }], { uid: ownerA.data.viewer.uid })
check('and cannot edit or delete the owner\'s items, with or without a persona', r.status === 409, r)
await as(pcode, carol.jar)
r = await ops(pcode, carol.jar, [{ op: 'update', id: ownerStarter, patch: { x: 5 } }, { op: 'delete', id: ownerStarter }, { op: 'vote', id: 'v-note' }], { uid: ownerA.data.viewer.uid })
check('...nor as a guest with one: update and delete are Not allowed, and a vote lands under the guest\'s own id', r.data.rejected.length === 2 && r.data.rejected.every((x) => x.error === 'Not allowed') && r.data.applied[0]?.votes?.includes(afterOut.data.viewer.uid) && !r.data.applied[0].votes.includes(ownerA.data.viewer.uid), r)
r = await putPersona(pcode, carol.jar, { kind: 'custom', name: 'Carol', avatar: AVATAR })
check('and cannot take the owner\'s name', r.status === 409, r)

console.log(`\nall ${n} checks passed against ${BASE}`)
