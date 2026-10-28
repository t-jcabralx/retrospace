import test from 'node:test'
import assert from 'node:assert/strict'
import { json, fail, stripBoard, readJson, rateLimited, windowHit, windowCount, windowRefund, windowClear } from '../src/lib/http.js'

test('json and fail build Responses', async () => {
  const ok = json({ a: 1 })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { a: 1 })
  const created = json({ b: 2 }, 201)
  assert.equal(created.status, 201)
  const bad = fail(403, 'Not the owner')
  assert.equal(bad.status, 403)
  assert.deepEqual(await bad.json(), { error: 'Not the owner' })
})

test('stripBoard drops every hash field and keeps the rest', () => {
  const board = { code: 'ABCDEF', title: 't', ownerId: 'u_1', passcodeHash: 'scrypt$x', ownerKeyHash: 'old' }
  assert.deepEqual(stripBoard(board), { code: 'ABCDEF', title: 't', ownerId: 'u_1' })
  assert.equal(board.passcodeHash, 'scrypt$x')
})

test('readJson parses an object body and throws on malformed or non-object bodies', async () => {
  const req = (body) => new Request('http://x/', { method: 'POST', body })
  assert.deepEqual(await readJson(req('{"a":1}')), { a: 1 })
  await assert.rejects(readJson(req('{nope')))
  await assert.rejects(readJson(req('[1]')))
  await assert.rejects(readJson(req('null')))
})

test('rateLimited is false when Redis is not configured', async () => {
  const saved = [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN]
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  try {
    assert.equal(await rateLimited(new Request('http://x/'), 'x', 1), false)
  } finally {
    if (saved[0] !== undefined) process.env.UPSTASH_REDIS_REST_URL = saved[0]
    if (saved[1] !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = saved[1]
  }
})

test('windowRefund gives one hit back, never below zero, and leaves the rest of the count alone', async () => {
  const key = `refund-test-${Math.random()}`
  const opts = { localFallback: true, credential: true, redis: null }
  for (let i = 0; i < 5; i++) await windowHit(key, 60_000, opts)
  assert.equal(await windowCount(key, 60_000, opts), 5)
  await windowRefund(key, 60_000, { redis: null })
  assert.equal(await windowCount(key, 60_000, opts), 4)
  for (let i = 0; i < 10; i++) await windowRefund(key, 60_000, { redis: null })
  assert.equal(await windowCount(key, 60_000, opts), 0)
  await windowRefund(`never-seen-${Math.random()}`, 60_000, { redis: null }) // no counter: nothing happens
  await windowClear(key, 60_000, { redis: null })
})

test('windowRefund decrements the Redis counter and puts it back if it would go negative', async () => {
  const calls = []
  let value = 1
  const redis = { decr: async (k) => { calls.push(['decr', k]); return --value }, incr: async (k) => { calls.push(['incr', k]); return ++value } }
  const now = 120_000
  await windowRefund('k', 60_000, { redis, now })
  assert.deepEqual(calls, [['decr', 'rl:k:2']])
  assert.equal(value, 0)
  calls.length = 0
  await windowRefund('k', 60_000, { redis, now }) // already zero: decr gives -1, so it is corrected
  assert.deepEqual(calls.map((c) => c[0]), ['decr', 'incr'])
  assert.equal(value, 0)
  await windowRefund('k', 60_000, { redis: { decr: async () => { throw new Error('down') } }, now }) // best effort
})
