import test from 'node:test'
import assert from 'node:assert/strict'
import { ownerError, patchBoardRequest, resetVotesRequest } from '../src/ui/ownerApi.js'

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })

test('ownerError gives a plain sentence for 401, 403, 429, 404, a network failure and the server\'s own 400 text', () => {
  assert.match(ownerError(401), /sign in/i)
  assert.match(ownerError(403), /owner/i)
  assert.match(ownerError(429), /wait/i)
  assert.match(ownerError(404), /no longer exists/i)
  assert.match(ownerError(0), /reach the server/i)
  assert.equal(ownerError(400, 'title required'), 'Title required')
  assert.match(ownerError(500), /\(500\)/)
  assert.match(ownerError(400), /\(400\)/)
})

test('patchBoardRequest sends { patch, cid } as a PATCH and returns the body on success', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push([url, init]); return { ok: true, status: 200, json: async () => ({ board: { title: 'x' } }) } }
  const r = await patchBoardRequest('ABC234', { locked: true }, 'c123', fetchImpl)
  assert.deepEqual(r, { ok: true, data: { board: { title: 'x' } } })
  assert.equal(seen[0][0], '/api/boards/ABC234')
  assert.equal(seen[0][1].method, 'PATCH')
  assert.deepEqual(JSON.parse(seen[0][1].body), { patch: { locked: true }, cid: 'c123' })
})

test('the cid is left out, never null or empty, when it is unknown', async () => {
  for (const cid of [undefined, null, '', 5]) {
    let body
    await patchBoardRequest('ABC234', { locked: false }, cid, async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({}) } })
    assert.deepEqual(body, { patch: { locked: false } }, String(cid))
  }
})

test('failures never throw: statuses become messages, a network error becomes status 0', async () => {
  for (const status of [401, 403, 429, 400, 500]) {
    const r = await patchBoardRequest('ABC234', { locked: true }, 'c1', reply(status, { error: 'nope' }))
    assert.equal(r.ok, false)
    assert.equal(r.status, status)
    assert.equal(typeof r.error, 'string')
  }
  const off = await patchBoardRequest('ABC234', { locked: true }, 'c1', async () => { throw new TypeError('network') })
  assert.deepEqual([off.ok, off.status], [false, 0])
  const garbage = await patchBoardRequest('ABC234', { locked: true }, 'c1', async () => ({ ok: false, status: 502, json: async () => { throw new Error('html') } }))
  assert.equal(garbage.status, 502)
})

test('resetVotesRequest posts to the reset route with the cid', async () => {
  let seen
  const r = await resetVotesRequest('ABC234', 'c9', async (url, init) => { seen = [url, init]; return { ok: true, status: 200, json: async () => ({ cleared: 3 }) } })
  assert.deepEqual(r, { ok: true, data: { cleared: 3 } })
  assert.equal(seen[0], '/api/boards/ABC234/votes/reset')
  assert.equal(seen[1].method, 'POST')
  assert.deepEqual(JSON.parse(seen[1].body), { cid: 'c9' })
})
