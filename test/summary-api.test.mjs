import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { summaryError, getSummaryRequest, generateSummaryRequest, showSummaryButton } from '../src/ui/summaryApi.js'

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })

test('summaryError turns a status and the server\'s code into a plain sentence', () => {
  assert.match(summaryError(0), /reach the server/)
  assert.match(summaryError(401), /sign in/i)
  assert.equal(summaryError(403, { error: 'AI is off for this board' }), 'AI is off for this board')
  assert.match(summaryError(403, {}), /owner/)
  assert.match(summaryError(404), /no longer exists/)
  assert.equal(summaryError(409, { error: 'Already writing' }), 'Already writing')
  assert.equal(summaryError(409, { error: 'Nothing to summarise yet' }), 'Nothing to summarise yet')
  assert.match(summaryError(503, { code: 'busy', error: 'x' }), /busy/)
  assert.match(summaryError(503, { code: 'misconfigured' }), /not set up correctly/)
  assert.match(summaryError(504, { code: 'timeout' }), /too long/)
  assert.match(summaryError(502, { code: 'empty' }), /did not write/)
  assert.equal(summaryError(503, { error: "AI isn't set up on this server" }), "AI isn't set up on this server")
  assert.match(summaryError(429, { error: 'Too many summaries for this board. Try again later.' }), /Too many/)
  assert.match(summaryError(500, {}), /\(500\)/)
})

test('the calls never throw and report failures with a sentence', async () => {
  const seen = []
  const ok = await generateSummaryRequest('ABC234', 'tab_1', async (url, init) => { seen.push([url, init]); return { ok: true, status: 200, json: async () => ({ summary: { text: 'x' } }) } })
  assert.deepEqual(ok, { ok: true, data: { summary: { text: 'x' } } })
  assert.equal(seen[0][0], '/api/boards/ABC234/summary')
  assert.equal(seen[0][1].method, 'POST')
  assert.deepEqual(JSON.parse(seen[0][1].body), { cid: 'tab_1' })
  const noCid = []
  await generateSummaryRequest('ABC234', null, async (u, init) => { noCid.push(init.body); return reply(200, {})() })
  assert.equal(noCid[0], '{}')
  assert.deepEqual(await getSummaryRequest('ABC234', reply(503, { code: 'busy' })), { ok: false, status: 503, error: summaryError(503, { code: 'busy' }) })
  assert.equal((await getSummaryRequest('ABC234', async () => { throw new Error('offline') })).status, 0)
  const get = []
  await getSummaryRequest('ABC234', async (u, init) => { get.push(init); return reply(200, {})() })
  assert.equal(get[0].method, 'GET')
  assert.ok(!('body' in get[0]))
})

test('who gets the Summary button', () => {
  const shared = { text: 't', status: 'shared' }
  assert.equal(showSummaryButton({ type: 'retro', summary: null }, true), true, 'owner on a retro board: always')
  assert.equal(showSummaryButton({ type: 'workshop', summary: null, ai: { enabled: false } }, true), false)
  assert.equal(showSummaryButton({ type: 'workshop', summary: null, ai: { enabled: true } }, true), true)
  assert.equal(showSummaryButton({ type: 'workshop', summary: shared }, true), true)
  assert.equal(showSummaryButton({ type: 'retro', summary: null }, false), false, 'a guest: only for a shared summary')
  assert.equal(showSummaryButton({ type: 'workshop', summary: shared }, false), true)
  assert.equal(showSummaryButton(undefined, true), false)
})

test('the AI settings show the agreed notice and ask for an explicit "I understand" before the first enable', async () => {
  const src = await readFile(new URL('../src/ui/settings/AiSection.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('The text of the board’s notes and cards is sent to Anthropic to write summaries and suggest themes. Participant names, avatars and ids are not sent, but anything people type may mention names. This includes an automatic summary when the board is closed. You review every summary before it is shared.'))
  assert.ok(src.includes('confirmLabel="I understand"'))
  assert.ok(src.includes('{ ai: { enabled: true, ack: true } }'), 'the first enable sends ack:true')
  assert.ok(src.includes('Not available on this server'))
  assert.ok(src.includes('Write a summary automatically when the board is closed') && src.includes('Share automatically'))
})
