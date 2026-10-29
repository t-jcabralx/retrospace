// A rehearsal of deploying during a live Retro vote. Two servers share ONE database (and one RT_SECRET): the OLD version (what is
// live) and the NEW version (what is about to be pushed). Usage: node scripts/sim-upgrade.mjs <oldUrl> <newUrl>
//
// A board is created and taken to the Vote stage on the OLD server, with three guests voting. Then the same people carry on
// through the NEW server (as they would right after a deploy), and the OLD server must still read everything the NEW one wrote
// (so a rollback is safe). Every vote count is compared across both servers at each step. Use a throwaway database.
import { randomBytes } from 'node:crypto'
import { generatePersona } from '../src/lib/persona.js'

const [OLD, NEW] = process.argv.slice(2).map((u) => (u ?? '').replace(/\/$/, ''))
if (!OLD || !NEW) { console.log('usage: node scripts/sim-upgrade.mjs <oldUrl> <newUrl>'); process.exit(1) }
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
let n = 0
const check = (name, ok, detail) => { n++; if (!ok) { console.log(`FAIL ${String(n).padStart(2, '0')} ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`); process.exit(1) } console.log(`PASS ${String(n).padStart(2, '0')} ${name}`) }

class Jar {
  constructor() { this.m = new Map() }
  absorb(list) { for (const c of list) { const [pair, ...attrs] = c.split(';').map((s) => s.trim()); const eq = pair.indexOf('='); const v = pair.slice(eq + 1); if (!v || attrs.includes('Max-Age=0')) this.m.delete(pair.slice(0, eq)); else this.m.set(pair.slice(0, eq), v) } }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ') }
}
async function call(base, method, path, body, jar) {
  const headers = { 'x-forwarded-for': IP, ...(body !== undefined && { 'content-type': 'application/json' }), ...(jar?.header() && { cookie: jar.header() }) }
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  jar?.absorb(res.headers.getSetCookie())
  const t = await res.text(); let data; try { data = JSON.parse(t) } catch { data = {} }
  return { status: res.status, data }
}
const counts = (items) => Object.fromEntries(items.filter((i) => i.kind === 'note').map((i) => [i.id, (i.votes ?? []).length]).sort())
const view = async (base, code, jar) => { const r = await call(base, 'GET', `/api/boards/${code}`, undefined, jar); return { board: r.data.board, items: r.data.items ?? [], status: r.status } }

const owner = new Jar()
check('the owner signs up on the OLD server', (await call(OLD, 'POST', '/api/auth/register', { email: `up-${randomBytes(4).toString('hex')}@example.com`, name: 'Olive Owner', password: 'correct horse battery' }, owner)).status === 200)
const code = (await call(OLD, 'POST', '/api/boards', { type: 'retro', template: 'retro-wwci', title: 'Live vote', votes: 3 }, owner)).data.code
check('a Retro board is created (3 votes each)', Boolean(code))

async function guest(label) {
  const jar = new Jar()
  const snap = await call(OLD, 'GET', `/api/boards/${code}`, undefined, jar)
  const put = await call(OLD, 'PUT', `/api/boards/${code}/persona`, { persona: generatePersona() }, jar)
  if (snap.status !== 200 || put.status !== 200) { console.log('FAIL guest', label, snap.status, put.status); process.exit(1) }
  return { jar, uid: snap.data.viewer.uid, label }
}
const g1 = await guest('g1'); const g2 = await guest('g2'); const g3 = await guest('g3')
const stage = (base, jar, action) => call(base, 'PATCH', `/api/boards/${code}`, { patch: { retro: action } }, jar)
const ops = (base, jar, list) => call(base, 'POST', `/api/boards/${code}/ops`, { ops: list }, jar)
const note = (id, text) => ({ op: 'add', item: { id, kind: 'note', x: 20 + (n % 5) * 210, y: 120, w: 200, h: 140, data: { text } } })

check('start, then Collect feedback', (await stage(OLD, owner, { type: 'start' })).status === 200 && (await stage(OLD, owner, { type: 'next' })).status === 200)
for (const [g, ids] of [[g1, ['a1', 'a2']], [g2, ['b1', 'b2']], [g3, ['c1', 'c2']]]) {
  const r = await ops(OLD, g.jar, ids.map((id) => note(id, `${g.label} says ${id}`)))
  check(`${g.label} adds two notes on the OLD server`, r.status === 200 && r.data.applied.length === 2, r.data)
}
check('Group, then Vote', (await stage(OLD, owner, { type: 'next' })).status === 200 && (await stage(OLD, owner, { type: 'next' })).status === 200)
const vote = (base, g, id) => ops(base, g.jar, [{ op: 'vote', id }])
for (const id of ['a1', 'b1']) check(`g1 votes ${id} (OLD)`, (await vote(OLD, g1, id)).data.applied?.length === 1)
for (const id of ['a1', 'a2', 'c1']) check(`g2 votes ${id} (OLD)`, (await vote(OLD, g2, id)).data.applied?.length === 1)
const oldView = await view(OLD, code, owner)
check('the OLD server shows the Vote stage with voting open', oldView.board.retro && oldView.board.vote.active === true, [oldView.board.retro?.current, oldView.board.vote])
const before = counts(oldView.items)
check('votes so far on the OLD server', before.a1 === 2 && before.a2 === 1 && before.b1 === 1 && before.c1 === 1, before)

// ---- the deploy happens: everyone carries on through the NEW server ----
const newView = await view(NEW, code, owner)
check('the NEW server reads the same board, stage and votes', newView.status === 200 && newView.board.retro.current === oldView.board.retro.current && newView.board.vote.active === true && JSON.stringify(counts(newView.items)) === JSON.stringify(before), counts(newView.items))
check('the NEW server shows no encryption flags (nothing was rewritten)', !JSON.stringify(newView).includes('enc1.'))
const g3view = await view(NEW, code, g3.jar)
check('a guest who joined on the OLD server is still the same person on the NEW one', g3view.status === 200 && g3view.board.viewer === undefined && (await call(NEW, 'GET', `/api/boards/${code}`, undefined, g3.jar)).data.viewer.uid === g3.uid)

check('g3 votes on the NEW server', (await vote(NEW, g3, 'a1')).data.applied?.length === 1 && (await vote(NEW, g3, 'b2')).data.applied?.length === 1)
check('g1 takes a vote back on the NEW server', (await vote(NEW, g1, 'b1')).data.applied?.length === 1)
await vote(NEW, g1, 'c2'); await vote(NEW, g1, 'b2')
const over = await vote(NEW, g1, 'a2')
check('a fourth vote is refused on the NEW server (the limit still holds)', over.data.rejected?.length === 1 && !over.data.applied?.length, over.data)
const afterNew = await view(NEW, code, owner)
const wantAfter = { a1: 3, a2: 1, b1: 0, b2: 2, c1: 1, c2: 1 }
check('the NEW server counts are right', JSON.stringify(counts(afterNew.items)) === JSON.stringify(wantAfter), counts(afterNew.items))

// ---- and back: the OLD server must read what the NEW one wrote (a rollback is safe) ----
const oldAfter = await view(OLD, code, owner)
check('the OLD server reads every vote the NEW server wrote', JSON.stringify(counts(oldAfter.items)) === JSON.stringify(wantAfter), counts(oldAfter.items))
check('a guest still votes fine on the OLD server after the NEW one wrote', (await vote(OLD, g3, 'c2')).data.applied?.length === 1)
check('the OLD server refuses a vote over the limit', (await vote(OLD, g3, 'c1')).data.rejected?.length === 1)

// ---- stage changes by the NEW server, seen by the OLD one ----
check('the owner moves to Review and discuss on the NEW server', (await stage(NEW, owner, { type: 'next' })).status === 200)
const closed = await view(OLD, code, g2.jar)
check('the OLD server sees the new stage and voting closed', closed.board.retro.current === 4 && closed.board.vote.active === false, [closed.board.retro?.current, closed.board.vote])
check('votes are refused once voting is closed (both servers)', (await vote(OLD, g2, 'b2')).data.rejected?.length === 1 && (await vote(NEW, g2, 'b2')).data.rejected?.length === 1)
const final = JSON.stringify(counts((await view(NEW, code, owner)).items))
check('both servers still agree on the final counts', final === JSON.stringify(counts((await view(OLD, code, owner)).items)), final)
console.log('PASS (all)')
