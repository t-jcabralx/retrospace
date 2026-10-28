import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore, createMongoStore } from '../src/lib/store.js'

const tpl = (id, ownerId, name, createdAt) => ({ id, ownerId, name, type: 'retro', columns: [{ title: 'A', emoji: '🔥' }], createdAt })
const dupCode = (e) => e?.code === 11000

// A scripted Mongo client: the templates collection backed by an array, supporting what the store uses.
function fakeClient() {
  const rows = []
  const calls = []
  const matches = (r, f) => Object.entries(f).every(([k, v]) => r[k] === v)
  const col = (name) => ({
    createIndex: async (...a) => { calls.push([name, 'createIndex', ...a]); return 'ok' },
    insertOne: async (doc) => {
      if (rows.some((r) => r.ownerId === doc.ownerId && r.nameLower === doc.nameLower) || rows.some((r) => r.id === doc.id)) throw Object.assign(new Error('E11000'), { code: 11000 })
      rows.push(structuredClone(doc))
    },
    find: (f) => ({ sort: (s) => ({ toArray: async () => rows.filter((r) => matches(r, f)).sort((a, b) => (b.createdAt - a.createdAt) * (s.createdAt === -1 ? 1 : -1)).map((r) => structuredClone(r)) }) }),
    deleteOne: async (f) => {
      const i = rows.findIndex((r) => matches(r, f))
      if (i >= 0) rows.splice(i, 1)
      return { deletedCount: i >= 0 ? 1 : 0 }
    },
  })
  return { client: { db: () => ({ collection: col }) }, calls }
}

const makers = { 'memory store': () => createMemoryStore(), 'mongo store (scripted collections)': () => createMongoStore(fakeClient().client, 'fake') }

for (const [label, make] of Object.entries(makers)) {
  describe(label + ': saved column templates', () => {
    test('create, list newest first per owner, delete only your own', async () => {
      const s = make()
      await s.createTemplate(tpl('tpl_1', 'u_a', 'One', 1))
      await s.createTemplate(tpl('tpl_2', 'u_a', 'Two', 2))
      await s.createTemplate(tpl('tpl_3', 'u_b', 'One', 3))
      assert.deepEqual((await s.listTemplates('u_a')).map((t) => t.id), ['tpl_2', 'tpl_1'])
      assert.deepEqual((await s.listTemplates('u_b')).map((t) => t.id), ['tpl_3'])
      assert.deepEqual(await s.listTemplates('u_nobody'), [])
      assert.equal(await s.deleteTemplate('u_b', 'tpl_1'), false, "not someone else's")
      assert.equal(await s.deleteTemplate('u_a', 'tpl_1'), true)
      assert.equal(await s.deleteTemplate('u_a', 'tpl_1'), false)
      assert.deepEqual((await s.listTemplates('u_a')).map((t) => t.id), ['tpl_2'])
    })

    test('a name is unique per owner, ignoring case (code 11000), and returned documents are copies', async () => {
      const s = make()
      const made = await s.createTemplate(tpl('tpl_1', 'u_a', 'Sprint', 1))
      await assert.rejects(s.createTemplate(tpl('tpl_2', 'u_a', 'SPRINT', 2)), dupCode)
      await s.createTemplate(tpl('tpl_3', 'u_b', 'Sprint', 3))
      made.columns[0].title = 'mutated'
      const [got] = await s.listTemplates('u_a')
      assert.equal(got.columns[0].title, 'A')
      got.columns[0].title = 'mutated'
      assert.equal((await s.listTemplates('u_a'))[0].columns[0].title, 'A')
    })
  })
}

test('mongo: the templates collection gets {ownerId, createdAt}, unique {ownerId, nameLower} and unique {id} indexes, and no _id leaks', async () => {
  const { client, calls } = fakeClient()
  const s = createMongoStore(client, 'fake')
  await s.createTemplate(tpl('tpl_1', 'u_a', 'One', 1))
  assert.deepEqual(calls.filter((c) => c[0] === 'templates' && c[1] === 'createIndex').map((c) => c.slice(2)), [
    [{ ownerId: 1, createdAt: -1 }],
    [{ ownerId: 1, nameLower: 1 }, { unique: true }],
    [{ id: 1 }, { unique: true }],
  ])
  assert.ok(!('_id' in (await s.listTemplates('u_a'))[0]))
})
