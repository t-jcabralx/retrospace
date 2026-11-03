import test from 'node:test'
import assert from 'node:assert/strict'
import { highlightsError, suggestHighlightsRequest } from '../src/ui/highlightsApi.js'

const answer = (status, body) => async () => new Response(JSON.stringify(body), { status })

test('the request posts to the board\'s highlights route and keeps only well-formed suggestions', async () => {
  let seen
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ suggestions: [{ id: 'a', reason: 'r' }, { reason: 'no id' }, null, { id: 7 }] }), { status: 200 }) }
  const r = await suggestHighlightsRequest('AB/CD', fetchImpl)
  assert.equal(seen.url, '/api/boards/AB%2FCD/highlights')
  assert.equal(seen.init.method, 'POST')
  assert.deepEqual(r, { ok: true, suggestions: [{ id: 'a', reason: 'r' }] })
})

test('errors are phrased for a person: the server\'s own message when it sent one, a plain line otherwise, and it never throws', async () => {
  assert.deepEqual(await suggestHighlightsRequest('X', answer(403, { error: 'AI is off for this board' })), { ok: false, status: 403, error: 'AI is off for this board' })
  assert.match((await suggestHighlightsRequest('X', answer(401, {}))).error, /session has ended/)
  assert.match((await suggestHighlightsRequest('X', answer(404, { error: 'Board not found' }))).error, /no longer exists/)
  assert.match((await suggestHighlightsRequest('X', answer(500, {}))).error, /Something went wrong \(500\)/)
  assert.deepEqual(await suggestHighlightsRequest('X', async () => { throw new Error('offline') }), { ok: false, status: 0, error: highlightsError(0) })
  assert.deepEqual(await suggestHighlightsRequest('X', async () => new Response('not json', { status: 200 })), { ok: true, suggestions: [] })
})
