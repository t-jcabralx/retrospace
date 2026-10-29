// Shared plumbing for route tests that need a signed-in owner, guests and a board: the in-memory store, no Redis.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

export const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`

export async function call(handler, method, path, { body, cookie, ip = fakeIp(), headers = {}, code } = {}) {
  const h = { 'x-forwarded-for': ip, ...headers }
  if (body !== undefined) h['content-type'] ??= 'application/json'
  if (cookie) h.cookie = Array.isArray(cookie) ? cookie.join('; ') : cookie
  const res = await handler(new Request(`http://localhost:3100${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data, setCookies: res.headers.getSetCookie() }
}

export async function routes() {
  const [{ POST: createBoard }, board, { POST: register }, { PUT: personaRoute }, { generatePersona }] = await Promise.all([
    import('../../src/app/api/boards/route.js'),
    import('../../src/app/api/boards/[code]/route.js'),
    import('../../src/app/api/auth/register/route.js'),
    import('../../src/app/api/boards/[code]/persona/route.js'),
    import('../../src/lib/persona.js'),
  ])
  async function signUp(name) {
    const r = await call(register, 'POST', '/api/auth/register', { body: { email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' } })
    assert.equal(r.status, 200)
    return { id: r.data.user.id, cookie: r.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0] }
  }
  // A guest browser: the snapshot mints the rs_g cookie, then a persona is chosen. -> { cookie, uid } (uid = the per-board id).
  async function newGuest(code, extraCookie) {
    const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: extraCookie })
    assert.equal(snap.status, 200)
    const cookie = [extraCookie, snap.setCookies.find((c) => c.startsWith('rs_g=')).split(';')[0]].filter(Boolean).join('; ')
    assert.equal((await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie, body: { persona: generatePersona() } })).status, 200)
    return { cookie, uid: snap.data.viewer.uid }
  }
  const newBoard = (cookie, extra = {}) => call(createBoard, 'POST', '/api/boards', { cookie, body: { type: 'workshop', template: 'blank', title: 'T', ...extra } })
  return { board, signUp, newGuest, newBoard, createBoard }
}
