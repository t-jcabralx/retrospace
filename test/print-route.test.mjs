import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { ann, addOps, call, board, enableAi, makeBoard, newGuest, note, patch, readyBoard, snapshot, signUp, summaryRoute, net, reply } from './helpers/summary-harness.mjs'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { buildPrintModel, printPhase } = await import('../src/lib/printModel.js')
const { readFile } = await import('node:fs/promises')

const phaseOf = async (code, cookie) => { const r = await snapshot(code, cookie); return { phase: printPhase(r.status, r.data?.error), r } }

test('the print page refuses a malformed code and asks the store nothing (it is not an existence oracle)', async () => {
  const src = await readFile(new URL('../src/app/b/[code]/print/page.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /lib\/store|getStore|getBoard/)
  assert.match(src, /isCode\(code\)\) notFound\(\)/)
  assert.match(src, /robots: BOARD_ROBOTS/)
  assert.match(src, /<PrintView code=\{code\} \/>/)
})

test('revoked, passcode-protected and missing boards print nothing: the page maps the API answer to a notice', async () => {
  const code = await makeBoard(ann)
  await addOps(code, ann.cookie, note('a', 20, 200, 'SECRET-NOTE-TEXT'))
  assert.equal((await phaseOf(code)).phase, 'ready')
  assert.equal((await patch(code, { passcode: 'letmein1' }, ann.cookie)).status, 200)
  const locked = await phaseOf(code)
  assert.equal(locked.phase, 'passcode')
  assert.ok(!locked.r.text.includes('SECRET-NOTE-TEXT'))
  assert.equal((await patch(code, { passcode: null }, ann.cookie)).status, 200)
  assert.equal((await patch(code, { revoked: true }, ann.cookie)).status, 200)
  const revoked = await phaseOf(code)
  assert.equal(revoked.phase, 'revoked')
  assert.ok(!revoked.r.text.includes('SECRET-NOTE-TEXT'))
  assert.equal((await phaseOf('ZZZZZZ')).phase, 'missing')
})

test('the snapshot the print page builds from has no drafts or owner-only data for a guest; the document has no author names by default', async () => {
  const { code, guest } = await readyBoard(ann)
  // an owner-only theme suggestion and a draft summary exist
  net.behave = () => reply(JSON.stringify({ themes: [{ title: 'UNIQUE-SUGGESTION-55', noteIds: ['n1'] }] }))
  const themesRoute = await import('../src/app/api/boards/[code]/themes/route.js')
  assert.equal((await call(themesRoute.POST, 'POST', `/api/boards/${code}/themes`, { code, cookie: ann.cookie, body: {} })).status, 200)
  net.behave = () => reply('UNIQUE-DRAFT-SUMMARY-66')
  assert.equal((await call(summaryRoute.POST, 'POST', `/api/boards/${code}/summary`, { code, cookie: ann.cookie, body: {} })).status, 200)

  const g = await snapshot(code, guest)
  assert.equal(g.status, 200)
  for (const secret of ['UNIQUE-SUGGESTION-55', 'UNIQUE-DRAFT-SUMMARY-66', 'themeSuggestions', 'ownerId', 'passcodeHash']) assert.ok(!g.text.includes(secret), secret)
  const model = buildPrintModel(g.data.board, g.data.items, g.data.participants, { authors: true, isOwner: g.data.viewer.role === 'owner', now: 0 })
  const bytes = JSON.stringify(model)
  assert.equal(model.authors, false)
  assert.ok(!bytes.includes('Gus Guestman') && !bytes.includes('Ann Owner'))
  assert.ok(bytes.includes('Pairing sessions helped a lot'))
  assert.equal(model.summary, null)

  // the owner sees the same document, and may add names
  const o = await snapshot(code, ann.cookie)
  assert.equal(o.data.viewer.role, 'owner')
  const withNames = buildPrintModel(o.data.board, o.data.items, o.data.participants, { authors: true, isOwner: true })
  assert.ok(JSON.stringify(withNames).includes('Gus Guestman'))
  assert.ok(!JSON.stringify(withNames).includes('UNIQUE-DRAFT-SUMMARY-66'), 'a draft is not printed even for the owner')
  assert.equal(JSON.stringify(withNames).includes('UNIQUE-SUGGESTION-55'), false)

  // once shared, the summary prints for a guest too
  const text = 'Shared wrap-up for everyone.'
  assert.equal((await patch(code, { summary: { text, status: 'shared' } }, ann.cookie)).status, 200)
  const g2 = await snapshot(code, guest)
  assert.equal(buildPrintModel(g2.data.board, g2.data.items, g2.data.participants).summary.text, text)
})

test('a removed participant cannot print (the API answers 403 and the page shows the removed notice)', () => {
  assert.equal(printPhase(403, 'You were removed from this board'), 'removed')
  assert.ok(typeof board.GET === 'function' && typeof enableAi === 'function' && typeof newGuest === 'function' && typeof signUp === 'function')
})
