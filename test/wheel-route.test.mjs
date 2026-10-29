import test from 'node:test'
import assert from 'node:assert/strict'
import { call, routes } from './helpers/routes.mjs'

const { board, signUp, newGuest, newBoard } = await routes()
const { POST: wheelRoute } = await import('../src/app/api/boards/[code]/wheel/route.js')
const { getStore } = await import('../src/lib/store.js')
const { SPIN } = await import('../src/lib/wheel.js')

const owner = await signUp('wanda')
const setup = { participants: [{ name: 'Maria' }, { name: 'John' }, { name: 'Priya' }], prizes: [{ name: 'Gift card', qty: 1 }, { name: 'Coffee', qty: 2 }], helpers: [] }

async function fresh(extra = {}) {
  const code = (await newBoard(owner.cookie, { type: 'event', template: 'raffle', title: 'Raffle' })).data.code
  const r = await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: owner.cookie, body: { patch: { wheel: { ...setup, ...extra } } } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return code
}
const act = (code, cookie, action) => call(wheelRoute, 'POST', `/api/boards/${code}/wheel`, { code, cookie, body: { action } })
// The spin must have finished before the next step: move the stored spin into the past instead of sleeping.
async function settle(code) {
  const store = getStore()
  const b = await store.getBoard(code)
  if (b.wheel.round.spin) await store.updateBoard(code, { wheel: { ...b.wheel, round: { ...b.wheel.round, spin: { ...b.wheel.round.spin, startAt: 1 } } } })
}

test('the owner runs a whole round and the result is stored on the server', async () => {
  const code = await fresh()
  let r = await act(code, owner.cookie, 'spin-prize')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.board.wheel.round.state, 'prizeChosen')
  assert.equal(r.data.board.wheel.round.spin.step, 'prize')
  assert.ok(r.data.board.wheel.round.spin.startAt >= Date.now() + SPIN.leadMs - 2000)
  await settle(code)
  r = await act(code, owner.cookie, 'spin-winner')
  assert.equal(r.data.board.wheel.round.state, 'winnerChosen')
  await settle(code)
  r = await act(code, owner.cookie, 'accept')
  assert.equal(r.status, 200)
  assert.equal(r.data.board.wheel.history.length, 1)
  const stored = (await getStore().getBoard(code)).wheel
  assert.equal(stored.history[0].by.length > 0, true)
  assert.equal(stored.round.state, 'idle')
})

test('the winner is spread over the whole list, never fixed', async () => {
  const seen = new Set()
  for (let i = 0; i < 24 && seen.size < 3; i++) {
    const code = await fresh()
    await act(code, owner.cookie, 'spin-prize')
    await settle(code)
    const r = await act(code, owner.cookie, 'spin-winner')
    seen.add(r.data.board.wheel.round.winnerId)
  }
  assert.equal(seen.size, 3)
})

test('a named helper can run the draw; an ordinary guest and a removed helper cannot', async () => {
  const code = await fresh()
  const helper = await newGuest(code)
  const other = await newGuest(code)
  assert.equal((await act(code, helper.cookie, 'spin-prize')).status, 403)
  const set = await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: owner.cookie, body: { patch: { wheel: { ...setup, helpers: [helper.uid] } } } })
  assert.equal(set.status, 200)
  assert.equal((await act(code, other.cookie, 'spin-prize')).status, 403)
  const ok = await act(code, helper.cookie, 'spin-prize')
  assert.equal(ok.status, 200)
  assert.equal(ok.data.board.wheel.round.state, 'prizeChosen')
  await settle(code)
  await act(code, owner.cookie, 'back')
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: owner.cookie, body: { patch: { wheel: { ...setup, helpers: [] } } } })
  assert.equal((await act(code, helper.cookie, 'spin-prize')).status, 403)
})

test('no session and no guest cookie is refused, and so is a board that is not an Event', async () => {
  const code = await fresh()
  assert.ok([401, 403].includes((await act(code, undefined, 'spin-prize')).status))
  const plain = (await newBoard(owner.cookie)).data.code
  assert.equal((await act(plain, owner.cookie, 'spin-prize')).status, 400)
})

test('a step from the wrong state is a 409 with a plain message, and an unknown action a 400', async () => {
  const code = await fresh()
  const early = await act(code, owner.cookie, 'spin-winner')
  assert.equal(early.status, 409)
  assert.match(early.data.error, /prize first/)
  assert.equal((await act(code, owner.cookie, 'launch-missiles')).status, 400)
  assert.equal((await call(wheelRoute, 'POST', `/api/boards/${code}/wheel`, { code, cookie: owner.cookie, body: { action: 'spin-prize', cid: 'bad cid!' } })).status, 400)
})

test('two presses at the same moment start exactly one spin', async () => {
  const code = await fresh()
  const helper = await newGuest(code)
  await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: owner.cookie, body: { patch: { wheel: { ...setup, helpers: [helper.uid] } } } })
  const [a, b] = await Promise.all([act(code, owner.cookie, 'spin-prize'), act(code, helper.cookie, 'spin-prize')])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const stored = (await getStore().getBoard(code)).wheel
  assert.equal(stored.round.n, 1)
})

test('a spin cannot be followed up before it has finished turning', async () => {
  const code = await fresh()
  await act(code, owner.cookie, 'spin-prize')
  const r = await act(code, owner.cookie, 'spin-winner')
  assert.equal(r.status, 409)
  assert.match(r.data.error, /Wait/)
})

test('with nobody on the wheel the spin is refused with a plain message', async () => {
  const code = await fresh({ participants: [] })
  const r = await act(code, owner.cookie, 'spin-prize')
  assert.equal(r.status, 409)
  assert.match(r.data.error, /participant/)
})
