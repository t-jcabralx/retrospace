import test from 'node:test'
import assert from 'node:assert/strict'
import { call, routes } from './helpers/routes.mjs'

const { newBoard, signUp, board } = await routes()
const { DELETE: del } = await import('../src/app/api/auth/account/route.js')
const { getStore } = await import('../src/lib/store.js')
const { deleteAccount } = await import('../src/lib/account.js')
const { spawnSync } = await import('node:child_process')

const PASSWORD = 'correct horse battery'
const remove = (cookie, password) => call(del, 'DELETE', '/api/auth/account', { cookie, body: { password } })

test('deleting an account removes its boards, templates, sign-ins and the account, and nothing of anyone else', async () => {
  const store = getStore()
  const ann = await signUp('ann')
  const bob = await signUp('bob')
  const a1 = (await newBoard(ann.cookie)).data.code
  const a2 = (await newBoard(ann.cookie, { type: 'event', template: 'raffle', title: 'Raffle' })).data.code
  const b1 = (await newBoard(bob.cookie)).data.code
  await store.createTemplate({ id: 'ta', ownerId: ann.id, name: 'Ann cols', columns: [], createdAt: 1 })
  await store.createTemplate({ id: 'tb', ownerId: bob.id, name: 'Bob cols', columns: [], createdAt: 1 })

  const wrong = await remove(ann.cookie, 'not the password')
  assert.equal(wrong.status, 403)
  assert.ok(await store.getBoard(a1)) // a wrong password changes nothing

  const r = await remove(ann.cookie, PASSWORD)
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.boards, 2)
  assert.ok(r.setCookies.some((c) => c.startsWith('rs_session=;') || /rs_session=;/.test(c)))
  for (const code of [a1, a2]) assert.equal(await store.getBoard(code), null)
  assert.equal(await store.getUserById(ann.id), null)
  assert.deepEqual(await store.listTemplates(ann.id), [])
  assert.equal((await call(board.GET, 'GET', `/api/boards/${a1}`, { code: a1 })).status, 404)
  assert.equal((await remove(ann.cookie, PASSWORD)).status, 401) // the old sign-in is gone

  assert.ok(await store.getBoard(b1)) // Bob is untouched
  assert.equal((await store.listTemplates(bob.id)).length, 1)
  assert.ok(await store.getUserById(bob.id))
})

test('it needs a session and a password, and a missing password is a 400', async () => {
  const eve = await signUp('eve')
  assert.equal((await remove(undefined, PASSWORD)).status, 401)
  assert.equal((await call(del, 'DELETE', '/api/auth/account', { cookie: eve.cookie, body: {} })).status, 400)
  assert.ok(await getStore().getUserById(eve.id))
})

test('the helper reports how many boards went', async () => {
  const store = getStore()
  const user = { id: 'u_helper', email: 'h@example.com', name: 'H', passwordHash: 'x', createdAt: 1 }
  await store.createUser(user)
  assert.deepEqual(await deleteAccount(store, user, { announce: false }), { boards: 0 })
  assert.equal(await store.getUserById('u_helper'), null)
})

test('the purge script refuses to delete without the backup flag or with a tiny number of days', () => {
  const env = { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/x' }
  const a = spawnSync(process.execPath, ['scripts/purge-old-boards.mjs', '--days', '365', '--apply'], { env, encoding: 'utf8' })
  assert.notEqual(a.status, 0)
  assert.match(a.stderr, /backup/)
  const b = spawnSync(process.execPath, ['scripts/purge-old-boards.mjs', '--days', '2'], { env, encoding: 'utf8' })
  assert.notEqual(b.status, 0)
  assert.match(b.stderr, /at least 30/)
})
