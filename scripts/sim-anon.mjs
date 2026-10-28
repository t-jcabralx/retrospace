// Black-box simulation of anonymous notes: owner plus two guests over HTTP. Usage: node scripts/sim-anon.mjs [baseUrl]
// (default http://localhost:3000). Start a FRESH dev server with blanked services first. Every response body of the run
// is kept and searched at the end for the author's public id and persona name: they may appear only where a note is NOT anonymous.
import { randomBytes } from 'node:crypto'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const AV = { bg: 3, body: 4, eyes: 5, mouth: 6, extra: 7 }

class Jar {
  constructor() { this.m = new Map() }
  absorb(list) {
    for (const c of list) {
      const [pair] = c.split(';')
      const eq = pair.indexOf('=')
      if (pair.slice(eq + 1)) this.m.set(pair.slice(0, eq), pair.slice(eq + 1))
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function call(method, path, body, jar) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  jar?.absorb(res.headers.getSetCookie())
  let data
  try { data = JSON.parse(text) } catch { data = {} }
  return { status: res.status, data, text }
}

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

const owner = new Jar()
const reg = await call('POST', '/api/auth/register', { email: `dana-${rnd()}@example.com`, name: 'Dana Owner', password: 'correct horse battery' }, owner)
check('owner registers', reg.status === 200, reg.data)
const made = await call('POST', '/api/boards', { type: 'retro', template: 'retro-wwci', title: 'Anon sim' }, owner)
const code = made.data.code
check('retro board created', typeof code === 'string')
const board = `/api/boards/${code}`
check('the stage allows guest notes', (await call('PATCH', board, { patch: { retro: { type: 'goto', index: 1 } } }, owner)).status === 200)

const NAME_A = `Zorblax-${rnd()}`
async function guest(name) {
  const jar = new Jar()
  const snap = await call('GET', board, undefined, jar)
  const ok = await call('PUT', `${board}/persona`, { persona: { kind: 'custom', name, avatar: AV } }, jar)
  check(`${name} joins`, ok.status === 200, ok.data)
  return { jar, uid: snap.data.viewer.uid, name, bodies: [] }
}
const a = await guest(NAME_A)
const b = await guest(`Mimsy-${rnd()}`)
const seen = [] // every body that a viewer other than the author got
const take = (r) => { seen.push(r.text); return r }

const mode = (jar, v) => call('PATCH', board, { patch: { anonymousNotes: v } }, jar)
check('default mode is optional', (await call('GET', board, undefined, b.jar)).data.board.anonymousNotes === 'optional')
check('a guest cannot change the mode', [401, 403].includes((await mode(a.jar, 'always')).status))
check('an invalid mode is 400', (await mode(owner, 'sometimes')).status === 400)

const anon = { op: 'add', item: { id: 'an1', kind: 'note', x: 10, y: 200, w: 200, h: 200, data: { text: 'anon idea' }, anon: true } }
const plain = { op: 'add', item: { id: 'pl1', kind: 'note', x: 300, y: 200, w: 200, h: 200, data: { text: 'plain idea' } } }
const add = await call('POST', `${board}/ops`, { ops: [anon, plain] }, a.jar)
check('the author adds an anonymous and a plain note', add.status === 200 && add.data.applied.length === 2, add.data)
const mineAnon = add.data.applied.find((i) => i.id === 'an1')
check('the author gets mine and the marker', mineAnon.mine === true && mineAnon.authorUid === 'anon' && mineAnon.authorName === 'Anonymous' && mineAnon.authorAvatar === null)

for (const [who, jar] of [['guest', b.jar], ['owner', owner]]) {
  const snap = take(await call('GET', board, undefined, jar))
  const since = take(await call('GET', `${board}/since?t=0`, undefined, jar))
  for (const [name, r] of [['snapshot', snap], ['since', since]]) {
    const item = r.data.items.find((i) => i.id === 'an1')
    check(`${who} ${name}: author hidden, no mine`, item.authorUid === 'anon' && !('mine' in item) && item.authorAvatar === null)
  }
}
const own = await call('GET', board, undefined, a.jar)
check('the author sees mine on the anonymous note only', own.data.items.find((i) => i.id === 'an1').mine === true && !('mine' in own.data.items.find((i) => i.id === 'pl1')))

const react = take(await call('POST', `${board}/ops`, { ops: [{ op: 'react', id: 'an1', emoji: '🎉' }] }, b.jar))
check('another guest reacting never learns the author', react.status === 200 && !react.text.includes(a.uid) && !react.text.includes(NAME_A))
const edit = await call('POST', `${board}/ops`, { ops: [{ op: 'update', id: 'an1', patch: { data: { text: 'anon idea v2' } } }] }, a.jar)
check('the author edits her anonymous note and it stays anonymous', edit.data.applied?.[0]?.anon === true && edit.data.applied[0].authorUid === 'anon')
const flip = await call('POST', `${board}/ops`, { ops: [{ op: 'update', id: 'an1', patch: { anon: false } }] }, a.jar)
check('anon cannot be switched off', flip.data.applied.length === 0 && /anon/.test(flip.data.rejected[0].error), flip.data)
const stranger = await call('POST', `${board}/ops`, { ops: [{ op: 'update', id: 'an1', patch: { x: 5 } }] }, b.jar)
check('another guest cannot edit it', stranger.data.applied.length === 0)

const csv = await fetch(`${BASE}${board}/export?format=csv&authors=1`, { headers: { cookie: owner.header(), 'x-forwarded-for': fakeIp() } })
const csvText = await csv.text()
seen.push(csvText)
check('CSV export names the plain author and says Anonymous for the anonymous note', csv.status === 200 && /anon idea v2.*,Anonymous/.test(csvText) && csvText.includes(NAME_A))

check('the owner can force anonymity', (await mode(owner, 'always')).status === 200)
const forced = await call('POST', `${board}/ops`, { ops: [{ op: 'add', item: { id: 'fo1', kind: 'note', x: 600, y: 200, w: 200, h: 200, data: { text: 'forced' } } }] }, b.jar)
check('"always" makes a guest note anonymous', forced.data.applied[0].anon === true && forced.data.applied[0].authorUid === 'anon', forced.data)
check('the owner can forbid it', (await mode(owner, 'never')).status === 200)
const refused = await call('POST', `${board}/ops`, { ops: [{ ...anon, item: { ...anon.item, id: 'an2' } }] }, a.jar)
check('"never" refuses anon: true', refused.data.applied.length === 0 && /off/.test(refused.data.rejected[0].error), refused.data)

// Every body a non-author received: the anonymous note's own JSON object must not hold the author's id or name.
for (const text of seen) {
  let data
  try { data = JSON.parse(text) } catch { continue }
  for (const it of [...(data.items ?? []), ...(data.applied ?? [])].filter((x) => x.anon === true)) {
    const raw = JSON.stringify(it)
    check(`anonymous note ${it.id} in a received body holds no author id or name`, !raw.includes(a.uid) && !raw.includes(NAME_A))
  }
}
console.log(`done: ${n} checks`)
