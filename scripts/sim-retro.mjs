// Black-box simulation of the staged Retro workflow: owner-driven stages, server-enforced rules, actions, topics.
// Usage: node scripts/sim-retro.mjs [baseUrl]  (default http://localhost:3000)
// Start a FRESH server first (blanked env): rate-limit counters live in the server process. Exits non-zero on the first failure.
import { randomBytes } from 'node:crypto'

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const rnd = () => randomBytes(4).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }

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
  get(name) { return this.m.get(name) }
}

const rawUids = new Set() // private cookie uids; none may appear in any body
const bodies = []
async function call(method, path, body, { jar } = {}) {
  const h = { 'x-forwarded-for': fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.header()) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  bodies.push(text)
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  const setCookies = res.headers.getSetCookie()
  for (const c of setCookies) if (c.startsWith('rs_g=')) rawUids.add(c.slice(5).split(';')[0].split('.')[0])
  jar?.absorb(setCookies)
  return { status: res.status, data, text, headers: res.headers }
}

let n = 0
function check(name, cond, detail) {
  n++
  if (!cond) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) }
  console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
}

async function account(name) {
  const jar = new Jar()
  const r = await call('POST', '/api/auth/register', { email: `${name}-${rnd()}@example.com`, name, password: 'correct horse battery' }, { jar })
  if (r.status !== 200) { console.log('FAIL could not register', name, r.status, r.data); process.exit(1) }
  return jar
}
async function guest(code, name) {
  const jar = new Jar()
  const snap = await call('GET', `/api/boards/${code}`, undefined, { jar })
  const put = await call('PUT', `/api/boards/${code}/persona`, { persona: { kind: 'custom', name, avatar: AV } }, { jar })
  if (put.status !== 200) { console.log('FAIL persona', put.status, put.data); process.exit(1) }
  return { jar, uid: snap.data.viewer.uid }
}
const note = (id, text) => ({ op: 'add', item: { id, kind: 'note', x: 10, y: 20, w: 200, h: 200, data: { text } } })
const ops = (code, jar, list) => call('POST', `/api/boards/${code}/ops`, { ops: list }, { jar })
const kick = (code, id, jar, q = '') => call('DELETE', `/api/boards/${code}/participants/${id}${q}`, undefined, { jar })
const patch = (code, jar, p) => call('PATCH', `/api/boards/${code}`, { patch: p }, { jar })
const stage = (code, jar, action) => patch(code, jar, { retro: action })
const action = (id, extra = {}) => ({ op: 'add', item: { id, kind: 'action', x: 10, y: 20, w: 240, h: 160, data: { action: `Do ${id}`, owner: '', due: '', ...extra } } })
const vote = (id) => ({ op: 'vote', id })
const view = async (code, jar) => (await call('GET', `/api/boards/${code}`, undefined, { jar })).data
const rejected = (r) => r.status === 200 && r.data.applied.length === 0 ? r.data.rejected[0]?.error : null

const owner = await account('Dana')
const code = (await call('POST', '/api/boards', { type: 'retro', template: 'retro-ssc', title: 'Retro sim' }, { jar: owner })).data.code
const gus = await guest(code, 'Gus')
const vic = await guest(code, 'Vic')

// --- creation and who may drive ---
let b = (await view(code, gus.jar)).board
check('a new retro board has the workflow, not started, 7 stages', b.retro && b.retro.stages.length === 7 && b.retro.current === 0 && b.retro.stageStartedAt === null, b.retro)
check('a guest cannot change the stage', [401, 403].includes((await stage(code, gus.jar, { type: 'next' })).status))
check('unknown retro actions are 400', (await stage(code, owner, { type: 'explode' })).status === 400)
check('unknown keys inside a retro action are 400', (await stage(code, owner, { type: 'next', current: 5 })).status === 400)
check('the retro state cannot be set directly', (await patch(code, owner, { retro: { current: 3 } })).status === 400)

// --- Join: notes are closed ---
let r = await stage(code, owner, { type: 'start' })
check('the owner starts the retro', r.status === 200 && r.data.board.retro.stageStartedAt > 0, r.data)
check('a guest note is refused in Join', rejected(await ops(code, gus.jar, [note('g0', 'early')])) === 'This stage is closed for notes')

// --- Collect ---
r = await stage(code, owner, { type: 'next' })
check('Collect opens editing and starts the shared timer', r.status === 200 && r.data.board.retro.editing === true && r.data.board.timer?.durationMs === 5 * 60_000, r.data.board)
check('a guest note is accepted in Collect', (await ops(code, gus.jar, [note('g1', 'from gus'), note('g2', 'second')])).status === 200)
check('another guest posts', (await ops(code, vic.jar, [note('v1', 'from vic')])).status === 200)
check('voting is closed in Collect', rejected(await ops(code, gus.jar, [vote('v1')])) === 'Voting is not open')
check('the owner can lock the notes', (await stage(code, owner, { type: 'setEditing', value: false })).data.board.retro.editing === false)
check('a locked Collect refuses guest notes', rejected(await ops(code, vic.jar, [note('v2', 'late')])) === 'This stage is closed for notes')
check('the owner can reopen them', (await stage(code, owner, { type: 'setEditing', value: true })).status === 200 && (await ops(code, vic.jar, [note('v2', 'ok now')])).status === 200)

// --- pause / extend ---
r = await stage(code, owner, { type: 'pause' })
check('pause stops the timer', r.status === 200 && r.data.board.retro.pausedAt > 0 && r.data.board.timer === null, r.data.board)
check('resume restarts it', (await stage(code, owner, { type: 'resume' })).data.board.timer?.endsAt > Date.now())
r = await stage(code, owner, { type: 'extend', ms: 60_000 })
check('+1 minute extends the timer', r.status === 200 && r.data.board.timer.endsAt > Date.now() + 5 * 60_000, r.data.board.timer)

// --- Group -> Vote ---
r = await stage(code, owner, { type: 'next' })
check('Group has no timer and no guest notes', r.data.board.timer === null && rejected(await ops(code, gus.jar, [note('g3', 'x')])) === 'This stage is closed for notes')
r = await stage(code, owner, { type: 'next' })
check('Vote opens the shared vote with votesPerPerson', r.data.board.vote.active === true && r.data.board.vote.perPerson === 3, r.data.board.vote)
for (const id of ['g1', 'g2', 'v1']) check(`a guest votes on ${id}`, (await ops(code, gus.jar, [vote(id)])).data.applied.length === 1)
check('the 4th vote is over the limit', rejected(await ops(code, gus.jar, [vote('v2')])) === 'No votes left')
check('notes stay closed while voting', rejected(await ops(code, gus.jar, [note('g4', 'x')])) === 'This stage is closed for notes')
await ops(code, vic.jar, [vote('v1'), vote('g1')])

// --- Discuss: topics ---
r = await stage(code, owner, { type: 'next' })
check('leaving Vote closes the vote', r.data.board.vote.active === false && r.data.board.retro.current === 4, r.data.board)
check('voting is refused after the stage', rejected(await ops(code, vic.jar, [vote('v2')])) === 'Voting is not open')
check('a guest cannot edit topics', [401, 403].includes((await stage(code, gus.jar, { type: 'topic', itemId: 'v1', status: 'discussed' })).status))
r = await stage(code, owner, { type: 'topic', itemId: 'v1', status: 'discussed', note: 'We agreed to pair more' })
check('the owner marks a topic with a note', r.status === 200 && r.data.board.retro.topics.v1.status === 'discussed' && r.data.board.retro.topics.v1.notes[0].text === 'We agreed to pair more', r.data)
check('a bad topic status is 400', (await stage(code, owner, { type: 'topic', itemId: 'v1', status: 'bogus' })).status === 400)
check('a prototype key as topic id is refused', (await stage(code, owner, { type: 'topic', itemId: '__proto__', status: 'discussed' })).status === 400)

// --- Actions ---
check('an action is refused before the Actions stage', rejected(await ops(code, gus.jar, [action('a0')])) === 'Actions are not open yet')
await stage(code, owner, { type: 'next' })
check('an action is accepted in Actions', (await ops(code, gus.jar, [action('a1', { owner: 'Gus', due: '2030-01-31' })])).status === 200)
check('a bad due date is refused', (await ops(code, gus.jar, [action('ax', { due: '2030-02-31' })])).data.applied.length === 0)
check('two more actions fill the limit', (await ops(code, vic.jar, [action('a2'), action('a3')])).data.applied.length === 2)
check('the 4th action is over the limit', rejected(await ops(code, vic.jar, [action('a4')])) === 'Action limit reached')
check('the owner is exempt from the limit', (await ops(code, owner, [action('a5')])).data.applied.length === 1)
check('notes are still closed in Actions', rejected(await ops(code, gus.jar, [note('g5', 'x')])) === 'This stage is closed for notes')

// --- Wrap up and jump ---
await stage(code, owner, { type: 'next' })
check('Wrap up is the last stage', (await stage(code, owner, { type: 'next' })).status === 400)
r = await stage(code, owner, { type: 'goto', index: 1 })
check('the owner can jump back to Collect', r.status === 200 && r.data.board.retro.current === 1 && r.data.board.retro.editing === true)

// --- what guests see ---
const seen = await view(code, vic.jar)
check('guests see the retro state', seen.board.retro?.stages?.length === 7 && seen.items.some((i) => i.kind === 'action'))
check('no private cookie uid in any response body', ![...rawUids].some((u) => bodies.some((b) => b.includes(u))))
console.log(`\nall ${n} checks passed`)
