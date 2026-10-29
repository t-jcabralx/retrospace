import test from 'node:test'
import assert from 'node:assert/strict'
import { call, routes } from './helpers/routes.mjs'

const { board, signUp, newGuest, newBoard } = await routes()
const { getStore } = await import('../src/lib/store.js')

const owner = await signUp('sheila')
const code = (await newBoard(owner.cookie, { type: 'event', template: 'raffle', title: 'Raffle' })).data.code
const patch = (cookie, wheel, extra = {}) => call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie, body: { patch: { wheel }, ...extra } })
const setup = { participants: [{ name: 'Maria' }, { name: 'John' }], prizes: [{ name: 'Gift card', qty: 2, emoji: '🎁' }], helpers: [], rules: { removeWinners: true } }

test('the owner saves the setup and everyone reads it back', async () => {
  const r = await patch(owner.cookie, setup)
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.deepEqual(r.data.board.wheel.participants.map((p) => p.name), ['Maria', 'John'])
  assert.equal(r.data.board.wheel.prizes[0].qty, 2)
  assert.equal(r.data.board.wheel.round.state, 'idle')
  const guest = await newGuest(code)
  const seen = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: guest.cookie })
  assert.equal(seen.data.board.wheel.participants.length, 2)
})

test('a guest cannot change the setup', async () => {
  const guest = await newGuest(code)
  const r = await patch(guest.cookie, { ...setup, participants: [{ name: 'Mallory' }] })
  assert.ok([401, 403].includes(r.status), r.status)
  assert.equal((await getStore().getBoard(code)).wheel.participants.length, 2)
})

test('the setup cannot set the round or the history, and bad input is refused', async () => {
  const before = (await getStore().getBoard(code)).wheel
  const r = await patch(owner.cookie, { ...setup, round: { state: 'winnerChosen', winnerId: 'x' }, history: [{ n: 99 }] })
  assert.equal(r.status, 200)
  const after = (await getStore().getBoard(code)).wheel
  assert.equal(after.round.state, 'idle')
  assert.deepEqual(after.history, before.history)
  assert.equal((await patch(owner.cookie, { participants: 'no', prizes: [] })).status, 400)
  assert.equal((await patch(owner.cookie, { ...setup, prizes: [{ name: 'x', qty: 500 }] })).status, 400)
})

test('the lists are locked while a round is in progress', async () => {
  const store = getStore()
  const b = await store.getBoard(code)
  await store.updateBoard(code, { wheel: { ...b.wheel, round: { ...b.wheel.round, state: 'prizeChosen' } } })
  const r = await patch(owner.cookie, setup)
  assert.equal(r.status, 400)
  assert.match(r.data.error, /round/)
  await store.updateBoard(code, { wheel: { ...b.wheel, round: { ...b.wheel.round, state: 'idle' } } })
})

test('a workshop board has no wheel to set', async () => {
  const other = (await newBoard(owner.cookie)).data.code
  const r = await call(board.PATCH, 'PATCH', `/api/boards/${other}`, { code: other, cookie: owner.cookie, body: { patch: { wheel: setup } } })
  assert.equal(r.status, 400)
})

test('casBoard writes once for a revision and refuses a stale one', async () => {
  const store = getStore()
  const b = await store.getBoard(code)
  const won = await store.casBoard(code, b.rev, { title: 'First' })
  assert.equal(won.title, 'First')
  assert.equal(won.rev, b.rev + 1)
  assert.equal(await store.casBoard(code, b.rev, { title: 'Second' }), null)
  assert.equal((await store.getBoard(code)).title, 'First')
  assert.equal(await store.casBoard('ZZZZZZ', 0, { title: 'x' }), null)
})
