import test from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { generateSummary, globalDailyCap } = await import('../src/lib/summary.js')
const { createMemoryStore } = await import('../src/lib/store.js')

async function boardWithNote(store, n) {
  const b = await store.createBoard({ code: `G${n}ABCD`.slice(0, 6), type: 'workshop', template: 'blank', title: 'T', ownerId: `owner-${n}-${Math.random()}`, ai: { enabled: true, ackAt: 1 } })
  await store.applyOps(b.code, [{ op: 'add', id: 'n1', item: { id: 'n1', kind: 'note', x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { text: 'a note' } } }], { uid: 'KM-AAAA-AAAA-AAAA', name: 'A', avatar: null, isOwner: true })
  return b.code
}

test('AI_DAILY_CAP: a global daily cap across every owner and board; past it a summary is refused with a limit error and no provider call', async () => {
  const saved = process.env.AI_DAILY_CAP
  process.env.AI_DAILY_CAP = '2'
  try {
    const store = createMemoryStore()
    let calls = 0
    const provider = { summarize: async () => { calls++; return { text: 'A summary', model: 'm' } } }
    const results = []
    for (let i = 0; i < 4; i++) results.push(await generateSummary(await boardWithNote(store, i), { store, provider }))
    const ok = results.filter((r) => r.ok).length
    assert.equal(ok, 2)
    assert.equal(calls, 2)
    const refused = results.filter((r) => !r.ok)
    assert.equal(refused.length, 2)
    for (const r of refused) assert.deepEqual([r.status, r.code], [429, 'limit'])
    assert.ok(refused[0].retryAfter > 0)
  } finally {
    saved === undefined ? delete process.env.AI_DAILY_CAP : (process.env.AI_DAILY_CAP = saved)
  }
})

test('globalDailyCap: default 300, a number from AI_DAILY_CAP otherwise', () => {
  const saved = process.env.AI_DAILY_CAP
  try {
    delete process.env.AI_DAILY_CAP
    assert.equal(globalDailyCap(), 300)
    process.env.AI_DAILY_CAP = ''
    assert.equal(globalDailyCap(), 300)
    process.env.AI_DAILY_CAP = 'abc'
    assert.equal(globalDailyCap(), 300)
    process.env.AI_DAILY_CAP = '25'
    assert.equal(globalDailyCap(), 25)
    process.env.AI_DAILY_CAP = '0'
    assert.equal(globalDailyCap(), 0)
  } finally {
    saved === undefined ? delete process.env.AI_DAILY_CAP : (process.env.AI_DAILY_CAP = saved)
  }
})
