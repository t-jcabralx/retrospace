import { mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'

// Shared set-up for the summary route tests (summary-routes and summary-auto). In-memory store, no Redis, and a fake
// Anthropic key: the provider is the real one, but the network is a stub that answers only api.anthropic.com (and the
// local fake Redis). Nothing here can reach the real API.
for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'AI_FAKE', 'AI_SUMMARY_MODEL']) delete process.env[k]
export const KEY = 'sk-ant-test-ROUTE-SECRET-9876'
process.env.ANTHROPIC_API_KEY = KEY

export const { POST: createBoard } = await import('../../src/app/api/boards/route.js')
export const board = await import('../../src/app/api/boards/[code]/route.js')
export const summaryRoute = await import('../../src/app/api/boards/[code]/summary/route.js')
export const { POST: opsRoute } = await import('../../src/app/api/boards/[code]/ops/route.js')
export const { GET: sinceRoute } = await import('../../src/app/api/boards/[code]/since/route.js')
export const { GET: revealRoute } = await import('../../src/app/api/boards/[code]/reveal/route.js')
export const { GET: myBoards } = await import('../../src/app/api/my-boards/route.js')
export const { POST: register } = await import('../../src/app/api/auth/register/route.js')
export const { PUT: personaRoute } = await import('../../src/app/api/boards/[code]/persona/route.js')
export const { setBackgroundRunner } = await import('../../src/lib/background.js')
export const { getStore } = await import('../../src/lib/store.js')
export const { windowHit } = await import('../../src/lib/http.js')

export const rnd = () => randomBytes(5).toString('hex')
export const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

export async function call(handler, method, path, { body, raw, cookie, code, headers = {} } = {}) {
  const h = { 'x-forwarded-for': fakeIp(), ...headers }
  if (body !== undefined || raw !== undefined) h['content-type'] ??= 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), code ? { params: Promise.resolve({ code }) } : undefined)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data, text, res, setCookies: res.headers.getSetCookie() }
}

// --- the stubbed network ---------------------------------------------------------------------------------------
export const requests = [] // every call to the "Anthropic API": { url, headers, body }
export const net = { behave: () => reply('Summary from the stub') } // what the stubbed Anthropic API answers next
export const reply = (text) => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 })
export const status = (code) => new Response(JSON.stringify({ error: { message: 'PROVIDER-SECRET-BODY' } }), { status: code })
const realFetch = globalThis.fetch // the fake Upstash server is a local http server and must keep working
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init)
  assert.equal(url, 'https://api.anthropic.com/v1/messages', 'only the Anthropic endpoint (or the local fake Redis) is ever fetched')
  requests.push({ url, headers: init.headers, body: JSON.parse(init.body), raw: init.body })
  return net.behave(requests.length)
}
export const userText = (r) => r.body.messages[0].content

// Everything logged during the file is kept to prove the key and the content never reach a log.
export const logged = []
for (const m of ['info', 'log', 'warn', 'error']) mock.method(console, m, (...a) => logged.push(a.map(String).join(' ')))

// Background work (after()) is collected so a test can run it to the end.
export const background = []
setBackgroundRunner((task) => { background.push(Promise.resolve().then(task)) })
export const drain = async () => { while (background.length) await background.shift() }

// The summary limits are fixed windows (an hour and a day); a test that counts exactly must not straddle one.
export async function roomInWindows() {
  const left = Math.min(3_600_000 - (Date.now() % 3_600_000), 86_400_000 - (Date.now() % 86_400_000))
  if (left < 20_000) await new Promise((r) => setTimeout(r, left + 100))
}
await roomInWindows()

// A fake Upstash REST endpoint: records the pipelined commands (so what was published can be inspected) and counts INCRs.
export async function fakeUpstash(fn) {
  const cmds = []
  const counters = new Map()
  const server = http.createServer((rq, rs) => {
    let raw = ''
    rq.on('data', (c) => { raw += c })
    rq.on('end', () => {
      const list = JSON.parse(raw)
      cmds.push(...list)
      const out = list.map(([cmd, key]) => ({ result: cmd === 'incr' ? counters.set(key, (counters.get(key) ?? 0) + 1).get(key) : cmd === 'decr' ? counters.set(key, (counters.get(key) ?? 0) - 1).get(key) : 1 }))
      rs.writeHead(200, { 'content-type': 'application/json' })
      rs.end(JSON.stringify(out))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const saved = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].map((k) => [k, process.env[k]])
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${server.address().port}`
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  try {
    await fn(cmds)
  } finally {
    for (const [k, v] of saved) v === undefined ? delete process.env[k] : (process.env[k] = v)
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
}
export const published = (cmds) => cmds.filter((c) => c[0] === 'publish').map((c) => JSON.parse(c[2]))

// --- people and boards ---------------------------------------------------------------------------------------------
export async function signUp(name) {
  const email = `${name.replace(/\W/g, '')}-${rnd()}@example.com`
  const r = await call(register, 'POST', '/api/auth/register', { body: { email, name, password: 'correct horse battery' } })
  assert.equal(r.status, 200)
  return { id: r.data.user.id, email, name, cookie: r.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0] }
}

export async function newGuest(code) {
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
  const cookie = snap.setCookies.find((c) => c.startsWith('rs_g=')).split(';')[0]
  const persona = { kind: 'custom', name: 'Gus Guestman', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 } }
  assert.equal((await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie, body: { persona } })).status, 200)
  return cookie
}

export const note = (id, x, y, text) => ({ op: 'add', item: { id, kind: 'note', x, y, w: 200, h: 200, data: { text } } })
export const addOps = async (code, cookie, ...ops) => {
  const r = await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops } })
  assert.equal(r.data.rejected?.length, 0, JSON.stringify(r.data))
}

export async function makeBoard(owner, body = { type: 'retro', template: 'retro-wwci', title: 'Sprint 12' }) {
  const r = await call(createBoard, 'POST', '/api/boards', { cookie: owner.cookie, body })
  assert.equal(r.status, 200)
  return r.data.code
}

export const patch = (code, p, cookie, extra = {}) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie, body: { patch: p, ...extra } })
export const snapshot = (code, cookie) => call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie })
export const generate = (code, cookie, body = {}) => call(summaryRoute.POST, 'POST', `/api/boards/${code}/summary`, { code, cookie, body })
export const getSummary = (code, cookie) => call(summaryRoute.GET, 'GET', `/api/boards/${code}/summary`, { code, cookie })
export const enableAi = (code, owner, extra = {}) => patch(code, { ai: { enabled: true, ack: true, ...extra } }, owner.cookie)

// A retro board with AI on, one note by the owner in column 1 and one by a guest in column 2.
export async function readyBoard(owner, { ai = {}, type = 'retro', template = 'retro-wwci' } = {}) {
  const code = await makeBoard(owner, { type, template, title: 'Sprint 12' })
  const guest = await newGuest(code)
  if (type === 'retro') assert.equal((await patch(code, { retro: { type: 'goto', index: 1 } }, owner.cookie)).status, 200) // guests may add notes only in the Collect stage
  await addOps(code, owner.cookie, note('a', 20, 200, 'Pairing sessions helped a lot'))
  await addOps(code, guest, note('b', 440, 200, 'CI takes forty minutes'))
  assert.equal((await enableAi(code, owner, ai)).status, 200)
  return { code, guest }
}

export const ann = await signUp('Ann Owner')
export const bob = await signUp('Bob Other')

// The key and the board's text never reach a log; the only provider log is one line of counts.
export function assertCleanLogs() {
  const all = logged.join('\n')
  assert.ok(logged.length > 0)
  assert.ok(logged.every((l) => l.startsWith('ai-summary {') && !l.includes('\n')), logged.find((l) => !l.startsWith('ai-summary {')))
  for (const secret of [KEY, 'PROVIDER-SECRET', 'Pairing sessions', 'CI takes forty', 'Ignore previous', 'Gus', 'Summary from the stub']) assert.ok(!all.includes(secret), secret)
}
