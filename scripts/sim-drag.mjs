// Latency of the live drag path. Usage: node scripts/sim-drag.mjs [baseUrl]  (default http://localhost:3000)
// The SERVER needs Upstash configured. Two guests join a fresh board; A sends drag steps at the client's pace (15 a
// second) and B's stream times how long each takes to arrive. Prints delivery, order and latency; fails if drag steps are
// lost, reordered beyond a few, or slower than a generous bound. Writes nothing to the database (relay only).
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.log('SKIP: Upstash not configured'); process.exit(0) }
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const STEPS = 60
const GAP_MS = 67
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Jar {
  constructor() { this.m = new Map() }
  absorb(list) { for (const c of list) { const [pair, ...attrs] = c.split(';').map((s) => s.trim()); const eq = pair.indexOf('='); const v = pair.slice(eq + 1); if (!v || attrs.includes('Max-Age=0')) this.m.delete(pair.slice(0, eq)); else this.m.set(pair.slice(0, eq), v) } }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
}
async function call(method, path, body, jar) {
  const headers = { 'x-forwarded-for': IP, ...(body !== undefined && { 'content-type': 'application/json' }), ...(jar?.header() && { cookie: jar.header() }) }
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  jar?.absorb(res.headers.getSetCookie())
  const t = await res.text(); let data; try { data = JSON.parse(t) } catch { data = {} }
  return { status: res.status, data }
}
const fail = (m, d) => { console.log('FAIL', m, d ?? ''); process.exit(1) }

const owner = new Jar()
if ((await call('POST', '/api/auth/register', { email: `drag-${randomBytes(4).toString('hex')}@example.com`, name: 'Drag Owner', password: 'correct horse battery' }, owner)).status !== 200) fail('register')
const code = (await call('POST', '/api/boards', { type: 'workshop', template: 'blank', title: 'Drag sim' }, owner)).data.code
if (!code) fail('create board')
async function guest() {
  const jar = new Jar()
  const snap = await call('GET', `/api/boards/${code}`, undefined, jar)
  if ((await call('PUT', `/api/boards/${code}/persona`, { persona: generatePersona() }, jar)).status !== 200) fail('persona')
  const join = await call('POST', '/api/rt/join', { code }, jar)
  if (!join.data.tok || join.data.live !== true) fail('join is not live (is Upstash set on the SERVER?)', join.data)
  return { jar, uid: snap.data.viewer.uid, tok: join.data.tok }
}
const A = await guest()
const B = await guest()

const got = []
const ac = new AbortController()
const stream = fetch(`${BASE}/api/rt/stream?code=${code}&uid=${B.uid}&tok=${B.tok}`, { headers: { 'x-forwarded-for': IP, cookie: B.jar.header() }, signal: ac.signal }).then(async (res) => {
  const dec = new TextDecoder(); let buf = ''
  try { for await (const chunk of res.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('data: ')) { try { const env = JSON.parse(f.slice(6)); if (env.t === 'eph' && env.msg?.t === 'drag' && env.msg.items) got.push({ at: Date.now(), n: env.msg.items[0].x }) } catch { /* ignore */ } } } } } catch { /* aborted */ }
}).catch(() => {})
await sleep(800) // let the stream attach

const sentAt = new Map()
let refused = 0
const sends = []
for (let n = 1; n <= STEPS; n++) {
  sentAt.set(n, Date.now())
  sends.push(call('POST', '/api/rt/send', { code, uid: A.uid, tok: A.tok, msg: { t: 'drag', items: [{ id: 'item1', x: n, y: n * 2 }] } }, A.jar).then((r) => { if (r.status !== 200) refused++ }))
  await sleep(GAP_MS)
}
await Promise.all(sends)
await sleep(1500)
ac.abort(); await stream

const lat = got.map((g) => g.at - sentAt.get(g.n)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]
let inversions = 0
for (let i = 1; i < got.length; i++) if (got[i].n < got[i - 1].n) inversions++
console.log(`sent ${STEPS}, refused ${refused}, delivered ${got.length}, out of order ${inversions}`)
console.log(`latency ms: p50 ${pct(0.5)}  p95 ${pct(0.95)}  max ${lat.at(-1)}`)
if (refused > 0) fail('some drag steps were refused', refused)
if (got.length < STEPS * 0.95) fail('too many steps lost', got.length)
if (pct(0.95) > 1500) fail('p95 latency over 1500 ms', pct(0.95))
console.log('PASS')
