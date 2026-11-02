import test from 'node:test'
import assert from 'node:assert/strict'
process.env.RT_SECRET = 'test-secret'
import { call, routes } from './helpers/routes.mjs'

const { signUp, newGuest, newBoard } = await routes()
const { POST } = await import('../src/app/api/rt/authorize/route.js')
const { authorizeSignature, verifyAuthorize, AUTH_WINDOW_MS } = await import('../src/lib/rtAuthorize.js')
const { signTok } = await import('../src/lib/rt.js')
const { getStore } = await import('../src/lib/store.js')

// Known answers, copied into the realtime project's tests: if one side's signing ever changes, both suites fail.
const CODE = 'ABC234'
const UID = 'KM-AAAA-BBBB-CCCC'
const VECTORS = {
  ticket: signTok(CODE, UID, 1_700_000_000_000), // expires 1_700_001_800_000
  authorize: authorizeSignature(1_700_000_000_000, CODE, UID),
}
test('signing known answers (shared with the realtime project)', () => {
  assert.equal(VECTORS.ticket, '1700001800000.e959cb9c10caf67817c313f4058aa6df')
  assert.equal(VECTORS.authorize, '715045da2f6274b02215d3fdad94f4ac9317bfbcb43f11a05b78d5e464aa0bf4')
})

const owner = await signUp('olive')
const code = (await newBoard(owner.cookie)).data.code
const ann = await newGuest(code)
const ask = (who, extra = {}) => {
  const ts = extra.ts ?? Date.now()
  const uid = extra.uid ?? who.uid
  return call(POST, 'POST', '/api/rt/authorize', { body: { code: extra.code ?? code, uid }, headers: { 'x-rt-ts': String(ts), 'x-rt-sig': extra.sig ?? authorizeSignature(ts, extra.code ?? code, uid) } })
}

test('a signed question gets the facts about the person and the board, and writes nothing', async () => {
  const r = await ask(ann)
  assert.equal(r.status, 200)
  assert.deepEqual(Object.keys(r.data).sort(), ['banned', 'owner', 'persona', 'readOnly', 'revoked', 'throwables'])
  assert.equal(typeof r.data.persona.name, 'string')
  assert.ok(r.data.persona.avatar)
  assert.deepEqual([r.data.owner, r.data.revoked, r.data.banned, r.data.readOnly], [false, false, false, false])
  assert.deepEqual(r.data.throwables.enabled, false)
})

test('the facts change with the board: removed, revoked, closed and throwing on', async () => {
  const code2 = (await newBoard(owner.cookie)).data.code
  const guest = await newGuest(code2)
  await getStore().removeParticipant(code2, guest.uid)
  assert.equal((await ask(guest, { code: code2 })).data.banned, true)
  const code3 = (await newBoard(owner.cookie)).data.code
  const g3 = await newGuest(code3)
  await getStore().updateBoard(code3, { revoked: true, status: 'closed', throwables: { enabled: true, emojis: ['🍌'] } })
  const f = (await ask(g3, { code: code3 })).data
  assert.deepEqual([f.revoked, f.readOnly, f.throwables.enabled, f.throwables.emojis], [true, true, true, ['🍌']])
})

test('anything not signed by the realtime server is refused the same way, so nothing leaks about which boards exist', async () => {
  const same = async (r) => [r.status, r.data.error]
  const missing = await same(await ask(ann, { sig: '0'.repeat(64) }))
  assert.deepEqual(missing, [403, 'forbidden'])
  assert.deepEqual(await same(await ask(ann, { code: 'ZZZZ22', sig: '1'.repeat(64) })), missing, 'a board that does not exist looks the same')
  assert.deepEqual(await same(await ask(ann, { sig: 'not hex' })), missing)
  assert.deepEqual(await same(await ask(ann, { ts: Date.now() - AUTH_WINDOW_MS - 5000 })), missing, 'a question signed a minute ago is stale')
  const stolen = authorizeSignature(Date.now(), code, ann.uid)
  assert.deepEqual(await same(await ask(ann, { uid: 'KM-2222-3333-4444', sig: stolen })), missing, 'a signature is for one person on one board')
  assert.deepEqual(await same(await call(POST, 'POST', '/api/rt/authorize', { body: { code, uid: ann.uid } })), missing, 'no signature at all')
  assert.equal((await ask(ann, { code: 'ZZZZ22' })).status, 404, 'a properly signed question about a missing board is a 404 (only the realtime server can ask)')
})

test('verifyAuthorize: the window, the namespace and the secret', () => {
  const ts = 1_700_000_000_000
  const sig = authorizeSignature(ts, CODE, UID)
  assert.equal(verifyAuthorize({ ts, sig, code: CODE, uid: UID }, ts + 59_000), true)
  assert.equal(verifyAuthorize({ ts, sig, code: CODE, uid: UID }, ts + 61_000), false)
  assert.equal(verifyAuthorize({ ts, sig, code: CODE, uid: UID }, ts - 61_000), false)
  assert.equal(verifyAuthorize({ ts, sig, code: CODE, uid: UID }, ts, 'another-secret'), false)
  assert.notEqual(sig, signTok(CODE, UID, ts).split('.')[1], 'a ticket can never be used as a signature')
})
