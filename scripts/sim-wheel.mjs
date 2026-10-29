// Three separate browsers on one Event board, over the real realtime channel: the owner, a helper the owner named, and a
// guest who only watches. Usage: node scripts/sim-wheel.mjs [baseUrl]. The SERVER needs Upstash configured.
// Checks: the watcher sees the same spin as the runners, the helper can run the draw and the watcher cannot, a double press
// starts one spin, and the history is shared. Writes only to the (memory or real) board it creates.
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.log('SKIP: Upstash not configured'); process.exit(0) }
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const check = (name, ok, detail) => { n++; if (!ok) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) } console.log(`PASS ${String(n).padStart(2, '0')} ${name}`) }

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
function stream(code, who) {
  const seen = []
  const ac = new AbortController()
  fetch(`${BASE}/api/rt/stream?code=${code}&uid=${who.uid}&tok=${who.tok}`, { headers: { 'x-forwarded-for': IP, cookie: who.jar.header() }, signal: ac.signal }).then(async (res) => {
    const dec = new TextDecoder(); let buf = ''
    try { for await (const chunk of res.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('data: ')) { try { seen.push({ at: Date.now(), env: JSON.parse(f.slice(6)) }) } catch { /* ignore */ } } } } } catch { /* aborted */ }
  }).catch(() => {})
  return { seen, close: () => ac.abort() }
}
async function guest(code, label) {
  const jar = new Jar()
  const snap = await call('GET', `/api/boards/${code}`, undefined, jar)
  if ((await call('PUT', `/api/boards/${code}/persona`, { persona: generatePersona() }, jar)).status !== 200) { console.log('FAIL persona', label); process.exit(1) }
  const join = await call('POST', '/api/rt/join', { code }, jar)
  return { jar, uid: snap.data.viewer.uid, tok: join.data.tok, live: join.data.live }
}

const owner = new Jar()
check('the owner signs up', (await call('POST', '/api/auth/register', { email: `wheel-${randomBytes(4).toString('hex')}@example.com`, name: 'Olive Owner', password: 'correct horse battery' }, owner)).status === 200)
const code = (await call('POST', '/api/boards', { type: 'event', template: 'raffle', title: 'Sim raffle' }, owner)).data.code
check('an Event board is created', Boolean(code))
const helper = await guest(code, 'helper')
const watcher = await guest(code, 'watcher')
check('both guests join live', helper.live === true && watcher.live === true, [helper.live, watcher.live])
const w = stream(code, watcher)
const h = stream(code, helper)
await sleep(800)

const setup = await call('PATCH', `/api/boards/${code}`, { patch: { wheel: { participants: ['Maria', 'John', 'Priya', 'Chen'].map((name) => ({ name })), prizes: [{ name: 'Gift card', qty: 2, emoji: '🎁' }, { name: 'Coffee', qty: 2, emoji: '☕' }], helpers: [helper.uid], rules: { removeWinners: true, effect: 'fireworks', gif: null } } } }, owner)
check('the owner saves the lists and names a helper', setup.status === 200, setup.data)
await sleep(800)
check('the watcher sees the lists arrive live', w.seen.some((e) => e.env.t === 'board' && e.env.board?.wheel?.participants?.length === 4))

const act = (jar, action) => call('POST', `/api/boards/${code}/wheel`, { action }, jar)
check('the watcher cannot run the draw', (await act(watcher.jar, 'spin-prize')).status === 403)
const before = Date.now()
const [a, b] = await Promise.all([act(owner, 'spin-prize'), act(helper.jar, 'spin-prize')])
check('two presses at once start exactly one spin', [a.status, b.status].sort().join() === '200,409', [a.status, b.status])
await sleep(900)
const prizeMsg = w.seen.filter((e) => e.env.t === 'board' && e.env.board?.wheel?.round?.state === 'prizeChosen').at(-1)
check('the watcher receives that spin within a second', Boolean(prizeMsg) && prizeMsg.at - before < 2500, prizeMsg && prizeMsg.at - before)
const spin = prizeMsg.env.board.wheel.round.spin
const stored = (await call('GET', `/api/boards/${code}`, undefined, owner)).data.board.wheel.round.spin
check('the watcher and the owner agree on the spin (step, slice, start time)', spin.step === 'prize' && spin.index === stored.index && spin.startAt === stored.startAt, [spin, stored])

await sleep(Math.max(0, spin.startAt + spin.durationMs - Date.now()) + 300)
const win = await act(helper.jar, 'spin-winner')
check('the helper runs the second step', win.status === 200 && win.data.board.wheel.round.state === 'winnerChosen', win.data)
await sleep(900)
check('the watcher sees the winner step too', w.seen.some((e) => e.env.t === 'board' && e.env.board?.wheel?.round?.state === 'winnerChosen'))
const winSpin = win.data.board.wheel.round.spin
await sleep(Math.max(0, winSpin.startAt + winSpin.durationMs - Date.now()) + 300)
const ok = await act(owner, 'accept')
check('the owner accepts the winner', ok.status === 200 && ok.data.board.wheel.history.length === 1, ok.data)
await sleep(800)
const last = w.seen.filter((e) => e.env.t === 'board' && e.env.board?.wheel).at(-1).env.board.wheel
check('the watcher ends with the same history and the winner off the wheel', last.history.length === 1 && last.participants.filter((p) => p.won).length === 1 && last.round.state === 'idle', last.history)
check('the stream never carries the owner\'s account id to the watcher', !JSON.stringify(w.seen).includes('"ownerId"'))
w.close(); h.close()
console.log('PASS (all)')
