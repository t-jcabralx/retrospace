// Black-box realtime simulation. Usage: node scripts/sim-live.mjs [baseUrl]  (default http://localhost:3000)
// Needs the SERVER to have Upstash configured; this script only checks that the variables are set in its own
// environment as a cheap "is realtime expected here" signal, and never loads .env files itself.
// Exits 0 with SKIP when they are missing, non-zero on the first failed assertion.
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.log('SKIP: Upstash not configured')
  process.exit(0)
}

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const DELIVERY_MS = 1500

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) {
    console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
    process.exit(1)
  }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

// One address for the whole script, so the per-IP probing and join limits see one steady client and no other run.
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`

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
}

async function call(method, path, body, { jar } = {}) {
  const headers = { 'x-forwarded-for': IP }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.header()) headers.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  jar?.absorb(res.headers.getSetCookie())
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
  return { status: res.status, data }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A minimal SSE client over fetch: collects decoded `data:` envelopes.
function openStream(code, uid, tok, cookie) {
  const ac = new AbortController()
  const client = { envelopes: [], status: 0, ac, closed: false }
  const headers = { 'x-forwarded-for': IP, ...(cookie ? { cookie } : {}) }
  client.ready = fetch(`${BASE}/api/rt/stream?code=${code}&uid=${uid}&tok=${tok}`, { headers, signal: ac.signal }).then(async (res) => {
    client.status = res.status
    if (!res.ok) return
    const dec = new TextDecoder()
    let buf = ''
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i)
          buf = buf.slice(i + 2)
          if (!frame.startsWith('data: ')) continue
          try { client.envelopes.push({ at: Date.now(), env: JSON.parse(frame.slice(6)) }) } catch { /* ignore */ }
        }
      }
    } catch { /* aborted */ }
  }).catch(() => {})
  client.close = () => { client.closed = true; ac.abort() }
  return client
}

async function waitFor(client, pred, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const hit = client.envelopes.find((e) => pred(e.env))
    if (hit) return hit
    await sleep(25)
  }
  return null
}

// The owner has an account (a fresh one per run); the stream clients A and B stay session-less guests of an OPEN board.
// Each guest is a browser with its own cookie jar: the snapshot mints its signed rs_g identity, then it picks a persona.
const owner = new Jar()
const reg = await call('POST', '/api/auth/register', { email: `live-${randomBytes(4).toString('hex')}@example.com`, name: 'Live Owner', password: 'correct horse battery' }, { jar: owner })
check('register the owner account', reg.status === 200 && !!reg.data.user?.id, reg.status)
const created = await call('POST', '/api/boards', { type: 'workshop', template: 'blank', title: 'Live sim' }, { jar: owner })
check('create board (signed in)', created.status === 200 && !!created.data.code, created)
const code = created.data.code

async function guestBrowser() {
  const jar = new Jar()
  const snap = await call('GET', `/api/boards/${code}`, undefined, { jar })
  const persona = generatePersona()
  const put = await call('PUT', `/api/boards/${code}/persona`, { persona }, { jar })
  if (snap.status !== 200 || put.status !== 200) { console.log('FAIL could not set up a guest', snap.status, put.status); process.exit(1) }
  return { jar, uid: snap.data.viewer.uid, name: persona.name }
}
const A = await guestBrowser()
const B_ = await guestBrowser()
const uidA = A.uid
const uidB = B_.uid
const joinA = await call('POST', '/api/rt/join', { code }, { jar: A.jar })
const joinB = await call('POST', '/api/rt/join', { code }, { jar: B_.jar })
check('join with Upstash configured -> tok and live:true', joinA.status === 200 && joinB.status === 200 && !!joinA.data.tok && joinA.data.live === true, [joinA, joinB])
check('join unknown board -> 404', (await call('POST', '/api/rt/join', { code: 'ZZZZZZ' }, { jar: A.jar })).status === 404)

const bad = openStream(code, uidB, 'bad-token')
await bad.ready
check('stream with a bad token -> 403', bad.status === 403, bad.status)

let B = openStream(code, uidB, joinB.data.tok)

// The subscription becomes active a moment after the response starts: probe until a hello gets through.
let ready = null
for (let i = 0; i < 20 && !ready; i++) {
  await call('POST', '/api/rt/send', { code, uid: uidA, tok: joinA.data.tok, msg: { t: 'hello', name: 'Mallory' } })
  ready = await waitFor(B, (e) => e.t === 'eph' && e.from === uidA, 250)
}
check('B receives A\'s ephemeral hello, carrying A\'s STORED name (the "Mallory" the client sent is replaced)', !!ready && ready.env.msg.t === 'hello' && ready.env.msg.name === A.name && !JSON.stringify(ready.env).includes('Mallory'), ready)

const badSend = await call('POST', '/api/rt/send', { code, uid: uidA, tok: 'nope', msg: { t: 'cursor', x: 1, y: 1 } })
check('send with a bad token -> 403', badSend.status === 403, badSend)
const badType = await call('POST', '/api/rt/send', { code, uid: uidA, tok: joinA.data.tok, msg: { t: 'evil' } })
check('send with an unknown msg.t -> 400', badType.status === 400, badType)

// An op from A reaches B within 1,500 ms.
const note = (id, text) => ({ op: 'add', item: { id, kind: 'note', x: 10, y: 20, w: 200, h: 200, data: { text } } })
const sentAt = Date.now()
const r1 = await call('POST', `/api/boards/${code}/ops`, { ops: [note('live-1', 'hello')] }, { jar: A.jar })
check('A posts an op', r1.status === 200 && r1.data.applied.length === 1, r1)
const got = await waitFor(B, (e) => e.t === 'ops' && e.ops?.some((i) => i.id === 'live-1'), DELIVERY_MS)
check(`B receives A's op within ${DELIVERY_MS} ms`, !!got && got.env.from === uidA && got.at - sentAt <= DELIVERY_MS, got && { ms: got.at - sentAt })
check('envelope carries the applied item with its server updatedAt', got.env.ops[0].updatedAt === r1.data.applied[0].updatedAt)
const lastSeen = got.env.ops[0].updatedAt

// Catch up after reconnect: B drops, A writes, B returns and /since has what it missed.
B.close()
await sleep(200)
const r2 = await call('POST', `/api/boards/${code}/ops`, { ops: [note('live-2', 'while you were away')] }, { jar: A.jar })
check('A posts an op while B is disconnected', r2.status === 200 && r2.data.applied.length === 1, r2)
B = openStream(code, uidB, joinB.data.tok)
const since = await call('GET', `/api/boards/${code}/since?t=${lastSeen}`)
check('/since after reconnect returns the missed item', since.status === 200 && since.data.items.some((i) => i.id === 'live-2') && !since.data.items.some((i) => i.id === 'live-1'), since)

// A fresh stream works again after the reconnect.
let again = null
for (let i = 0; i < 20 && !again; i++) {
  await call('POST', '/api/rt/send', { code, uid: uidA, tok: joinA.data.tok, msg: { t: 'cursor', x: i, y: i } })
  again = await waitFor(B, (e) => e.t === 'eph' && e.msg?.t === 'cursor', 250)
}
check('reconnected stream delivers again', !!again, again)

B.close()

// Access withdrawn: a token that is still valid no longer opens a stream (stream authorizes at connect).
const revoke = await call('PATCH', `/api/boards/${code}`, { patch: { revoked: true } }, { jar: owner })
check('owner revokes the board', revoke.status === 200 && revoke.data.board.revoked === true, revoke.status)
const afterRevoke = openStream(code, uidB, joinB.data.tok)
await afterRevoke.ready
check('a NEW stream with a still-valid token is refused after a revoke -> 403', afterRevoke.status === 403, afterRevoke.status)
const unrevoke = await call('PATCH', `/api/boards/${code}`, { patch: { revoked: false } }, { jar: owner })
check('owner un-revokes', unrevoke.status === 200 && unrevoke.data.board.revoked === false, unrevoke.status)

const setPass = await call('PATCH', `/api/boards/${code}`, { patch: { passcode: 'live sim pass' } }, { jar: owner })
check('owner sets a passcode', setPass.status === 200, setPass.status)
const noCookie = openStream(code, uidB, joinB.data.tok)
await noCookie.ready
check('a new stream without the access cookie is refused on a passcode board -> 401', noCookie.status === 401, noCookie.status)
const guest = new Jar()
const entered = await call('POST', `/api/boards/${code}/join`, { passcode: 'live sim pass' }, { jar: guest })
check('a guest enters the passcode and gets the access cookie', entered.status === 200 && !!guest.header(), entered.status)
const withCookie = openStream(code, uidB, joinB.data.tok, guest.header())
await sleep(500) // an open stream's `ready` only settles when it ends, so give the response time to start
check('with the access cookie the stream opens -> 200', withCookie.status === 200, withCookie.status)
withCookie.close()

// ---------------------------------------------------------------- Task 7B: voting, timer and thrown emoji over the live stream
{
  const clear = await call('PATCH', `/api/boards/${code}`, { patch: { passcode: null } }, { jar: owner })
  check('7B: owner clears the passcode again', clear.status === 200 && clear.data.board.hasPasscode === false, clear.status)
  const S = openStream(code, uidB, joinB.data.tok)
  let up = null
  for (let i = 0; i < 20 && !up; i++) {
    await call('POST', '/api/rt/send', { code, uid: uidA, tok: joinA.data.tok, msg: { t: 'hello' } })
    up = await waitFor(S, (e) => e.t === 'eph' && e.msg?.t === 'hello', 250)
  }
  check('7B: a fresh stream for B is delivering', !!up)
  const note7 = (id) => ({ op: 'add', item: { id, kind: 'note', x: 1, y: 1, w: 200, h: 200, data: { text: id } } })
  await call('POST', `/api/boards/${code}/ops`, { ops: [note7('b1'), note7('b2')] }, { jar: A.jar })

  // voting
  let r = await call('POST', `/api/boards/${code}/ops`, { ops: [{ op: 'vote', id: 'b1' }] }, { jar: A.jar })
  check('7B: a vote before voting opens is rejected', r.data.rejected?.[0]?.error === 'Voting is not open', r.data)
  r = await call('PATCH', `/api/boards/${code}`, { patch: { vote: { active: true, perPerson: 1 } } }, { jar: owner })
  const boardEnv = await waitFor(S, (e) => e.t === 'board' && e.board?.vote?.active === true, DELIVERY_MS)
  check('7B: B hears that voting opened (board envelope with vote.active)', r.status === 200 && !!boardEnv && boardEnv.env.board.vote.perPerson === 1, boardEnv?.env)
  r = await call('POST', `/api/boards/${code}/ops`, { ops: [{ op: 'vote', id: 'b1' }, { op: 'vote', id: 'b2' }] }, { jar: A.jar })
  const voteEnv = await waitFor(S, (e) => e.t === 'ops' && e.ops?.some((i) => i.id === 'b1' && i.votes?.includes(uidA)), DELIVERY_MS)
  check('7B: A\'s vote reaches B, and the second one is refused "No votes left"', r.data.applied.length === 1 && r.data.rejected[0]?.error === 'No votes left' && !!voteEnv, r.data)
  r = await call('POST', `/api/boards/${code}/votes/reset`, {}, { jar: owner })
  const resetEnv = await waitFor(S, (e) => e.t === 'ops' && e.ops?.some((i) => i.id === 'b1' && i.votes?.length === 0), DELIVERY_MS)
  check('7B: the owner\'s reset reaches B as ops with empty votes', r.status === 200 && r.data.cleared === 1 && !!resetEnv, r.data)

  // the shared timer
  const endsAt = Date.now() + 120_000
  r = await call('PATCH', `/api/boards/${code}`, { patch: { timer: { endsAt, durationMs: 120_000 } } }, { jar: owner })
  const timerEnv = await waitFor(S, (e) => e.t === 'board' && e.board?.timer?.endsAt === endsAt, DELIVERY_MS)
  check('7B: B receives the timer with the server end time', r.status === 200 && !!timerEnv && timerEnv.env.board.timer.durationMs === 120_000, timerEnv?.env)
  r = await call('PATCH', `/api/boards/${code}`, { patch: { timer: null } }, { jar: owner })
  check('7B: the owner stops the timer', r.status === 200 && r.data.board.timer === null)

  // throwables: the owner turns them on, A throws, B sees one stamped with A's stored name
  const T = { t: 'throw', emoji: '🍌', itemId: 'b1', x: 5, y: 6 }
  const sendThrow = (msg) => call('POST', '/api/rt/send', { code, uid: uidA, tok: joinA.data.tok, msg })
  r = await sendThrow(T)
  check('7B: a throw while throwing is off -> 403', r.status === 403 && r.data.error === 'Throwing is off', r)
  await call('PATCH', `/api/boards/${code}`, { patch: { throwables: { enabled: true, emojis: ['🍌', '🍅'] } } }, { jar: owner })
  if (4500 - (Date.now() % 4500) < 1500) await sleep(1600) // the limit is a fixed 4.5 s window
  let ok = null
  for (let i = 0; i < 12 && !ok; i++) {
    const x = await sendThrow({ ...T, name: 'Mallory', uid: 'KM-2222-2222-2222' })
    if (x.status === 200) ok = x
    else await sleep(500) // another server process may still be holding the 5 s board cache
  }
  const thrown = await waitFor(S, (e) => e.t === 'eph' && e.msg?.t === 'throw', DELIVERY_MS)
  check('7B: B receives the throw with the emoji, the item and A\'s STORED name (Mallory is dropped)', !!ok && !!thrown && thrown.env.from === uidA && thrown.env.msg.emoji === '🍌' && thrown.env.msg.itemId === 'b1' && thrown.env.msg.name === A.name && !JSON.stringify(thrown.env).includes('Mallory') && !JSON.stringify(thrown.env).includes('KM-2222'), thrown?.env)
  r = await sendThrow({ ...T, emoji: '🔥' })
  check('7B: an emoji outside the list -> 403', r.status === 403, r)
  await sleep(4500 - (Date.now() % 4500) + 50) // a fresh 4.5 s window, so the four tries below cannot be split across two
  const codes = []
  for (let i = 0; i < 4; i++) codes.push((await sendThrow(T)).status)
  check('7B: the burst limit: 3 throws go through and the 4th inside the window is refused with 429', codes.join() === '200,200,200,429', codes)
  S.close()
}

console.log(`OK ${n} checks`)
process.exit(0)
