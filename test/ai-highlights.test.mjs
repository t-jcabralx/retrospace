import test from 'node:test'
import assert from 'node:assert/strict'
import { addOps, ann, bob, call, enableAi, getStore, makeBoard, newGuest, note, readyBoard, reply, requests, net, board } from './helpers/summary-harness.mjs'
import { buildHighlightInput, parseHighlights, fakeHighlights, cleanReason, MAX_AI_HIGHLIGHTS, MAX_REASON } from '../src/lib/ai/highlights.js'

const route = await import('../src/app/api/boards/[code]/highlights/route.js')
const suggest = (code, cookie, extra = {}) => call(route.POST, 'POST', `/api/boards/${code}/highlights`, { code, cookie, body: extra })
const answer = (highlights) => () => reply(JSON.stringify({ highlights }))
const lastPrompt = () => requests.at(-1).body.messages[0].content

test('parseHighlights: strict JSON only, unknown and repeated ids dropped, at most 8, reasons cleaned', () => {
  const ids = new Map(Array.from({ length: 12 }, (_, i) => [`n${i + 1}`, `real${i + 1}`]))
  assert.equal(parseHighlights('not json at all', ids), null)
  assert.equal(parseHighlights('{"highlights":"nope"}', ids), null)
  assert.equal(parseHighlights('{"themes":[]}', ids), null)
  assert.deepEqual(parseHighlights('Sure! ```json\n{"highlights":[{"noteId":"n2","reason":"Key insight"}]}\n```', ids), [{ id: 'real2', reason: 'Key insight' }])
  const messy = { highlights: [{ noteId: 'n1' }, { noteId: 'zzz', reason: 'x' }, { noteId: 'n1', reason: 'again' }, 'n3', null, { noteId: 7 }, { noteId: 'n4', reason: 42 }] }
  assert.deepEqual(parseHighlights(JSON.stringify(messy), ids), [{ id: 'real1', reason: '' }, { id: 'real4', reason: '' }])
  const many = { highlights: Array.from({ length: 12 }, (_, i) => ({ noteId: `n${i + 1}`, reason: 'r' })) }
  assert.equal(parseHighlights(JSON.stringify(many), ids).length, MAX_AI_HIGHLIGHTS)
  assert.deepEqual(parseHighlights('{"highlights":[]}', ids), [])
  assert.ok(cleanReason('x'.repeat(500)).length <= MAX_REASON)
  assert.equal(cleanReason('  one\n\n two   '), 'one two')
})

test('the fake answer picks the first note of each column, as the JSON the real model is asked for', () => {
  const text = 'Board title: T\n\n## Went well\n[n1] a\n[n2] b\n\n## Could improve\n[n3] c'
  assert.deepEqual(fakeHighlights(text), { highlights: [{ noteId: 'n1', reason: 'Sample reason from the development fake, not written by an AI.' }, { noteId: 'n3', reason: 'Sample reason from the development fake, not written by an AI.' }] })
})

test('the input holds short ids and note text only: no authors, no real ids', () => {
  const items = [
    { id: 'real-a', kind: 'note', x: 0, y: 0, w: 1, h: 1, data: { text: 'Pairing helped' }, authorName: 'Ann Secret', authorUid: 'uid-secret', votes: [], deleted: false, updatedAt: 1 },
    { id: 'real-line', kind: 'connector', x: 0, y: 0, w: 1, h: 1, data: { from: 'real-a', to: 'real-a' }, deleted: false, updatedAt: 1 },
  ]
  const input = buildHighlightInput(items, { boardTitle: 'Sprint 5' })
  assert.equal(input.count, 1)
  assert.match(input.text, /\[n1\] Pairing helped/)
  for (const leak of ['Ann Secret', 'uid-secret', 'real-a', 'real-line']) assert.ok(!input.text.includes(leak), leak)
  assert.equal(input.ids.get('n1'), 'real-a')
})

test('the highlight route is owner-only and carries the CSRF guards; none of it reaches the provider', async () => {
  const { code, guest } = await readyBoard(ann)
  const before = requests.length
  assert.equal((await suggest(code, undefined)).status, 401, 'no session')
  assert.equal((await suggest(code, guest)).status, 401, 'guest')
  assert.equal((await suggest(code, `${bob.cookie}; ${guest}`)).status, 403, 'another account')
  assert.equal((await call(route.POST, 'POST', `/api/boards/${code}/highlights`, { code, cookie: ann.cookie, raw: '{}', headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call(route.POST, 'POST', `/api/boards/${code}/highlights`, { code, cookie: ann.cookie, body: {}, headers: { origin: 'http://evil.example' } })).status, 403)
  assert.equal(requests.length, before)
})

test('AI off and a board with no notes are refused before anything is sent', async () => {
  const off = await makeBoard(ann)
  await addOps(off, ann.cookie, note('a', 20, 200, 'something'))
  const before = requests.length
  const a = await suggest(off, ann.cookie)
  assert.deepEqual([a.status, a.data.error], [403, 'AI is off for this board'])
  const empty = await makeBoard(ann)
  assert.equal((await enableAi(empty, ann)).status, 200)
  const b = await suggest(empty, ann.cookie)
  assert.deepEqual([b.status, b.data.error], [409, 'There are no notes to pick from yet'])
  assert.equal(requests.length, before)
})

test('a valid reply comes back as suggestions with real ids and reasons; nothing is stored or changed on the board', async () => {
  const { code } = await readyBoard(ann)
  net.behave = answer([{ noteId: 'n2', reason: 'The build is a real blocker' }, { noteId: 'n1', reason: 'Pairing worked' }])
  const r = await suggest(code, ann.cookie)
  assert.equal(r.status, 200)
  assert.deepEqual(r.data, { suggestions: [{ id: 'b', reason: 'The build is a real blocker' }, { id: 'a', reason: 'Pairing worked' }] })
  const body = requests.at(-1).body
  assert.ok(!('temperature' in body) && !('top_p' in body))
  assert.match(body.system, /ONE JSON object/)
  assert.match(body.system, /highlights/)
  const prompt = lastPrompt()
  assert.match(prompt, /^<board_content>\n/)
  assert.match(prompt, /\[n1\] Pairing sessions helped a lot/)
  for (const leak of ['Ann Owner', 'authorUid']) assert.ok(!prompt.includes(leak), leak)
  const items = await getStore().listItems(code)
  assert.ok(items.every((i) => i.hl !== true), 'no note was highlighted by asking')
  const stored = await getStore().getBoard(code)
  assert.ok(!JSON.stringify(stored).includes('The build is a real blocker'), 'the suggestions are not kept on the board')
})

test('a note that is already highlighted is not suggested again', async () => {
  const { code } = await readyBoard(ann)
  const { POST: ops } = await import('../src/app/api/boards/[code]/ops/route.js')
  assert.equal((await call(ops, 'POST', `/api/boards/${code}/ops`, { code, cookie: ann.cookie, body: { ops: [{ op: 'highlight', id: 'a', on: true }] } })).status, 200)
  net.behave = answer([{ noteId: 'n1', reason: 'x' }, { noteId: 'n2', reason: 'y' }])
  const r = await suggest(code, ann.cookie)
  assert.deepEqual(r.data.suggestions.map((s) => s.id), ['b'])
})

test('a reply that is not JSON is retried once; two bad replies are a 502', async () => {
  const { code } = await readyBoard(ann)
  const before = requests.length
  net.behave = () => reply('Here are my thoughts, no JSON')
  const r = await suggest(code, ann.cookie)
  assert.equal(r.status, 502)
  assert.equal(r.data.code, 'bad_reply')
  assert.equal(requests.length - before, 2)
})

test('five suggestions an hour per board, then 429 with a Retry-After', async () => {
  const { code } = await readyBoard(ann)
  net.behave = answer([{ noteId: 'n1', reason: 'r' }])
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await suggest(code, ann.cookie)).status)
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429])
})

test('the board view guests get never mentions the suggestions', async () => {
  const { code, guest } = await readyBoard(ann)
  net.behave = answer([{ noteId: 'n1', reason: 'UNIQUE-REASON-91' }])
  assert.equal((await suggest(code, ann.cookie)).status, 200)
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: guest })
  assert.ok(!snap.text.includes('UNIQUE-REASON-91'))
})
