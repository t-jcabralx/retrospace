import test from 'node:test'
import assert from 'node:assert/strict'
import { call, routes } from './helpers/routes.mjs'

const { board, signUp, newGuest, newBoard } = await routes()
const { BOARD_TYPES, typeInfo } = await import('../src/lib/boardTypes.js')
const { getTemplate } = await import('../src/lib/templates.js')
const { validateBoardInput } = await import('../src/lib/validate.js')
const { planOps } = await import('../src/lib/plan.js')
const { reducer, initialState } = await import('../src/client/state.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')

const owner = await signUp('olive')
const EVENT = { type: 'event', template: 'raffle', title: 'Friday raffle' }

test('Event is a board type with a Raffle day template and no canvas', () => {
  assert.ok(BOARD_TYPES.some((t) => t.key === 'event'))
  assert.equal(typeInfo('event').short, 'Event')
  assert.equal(getTemplate('event', 'raffle').starterItems().length, 0)
  const v = validateBoardInput({ ...EVENT, recipient: { name: 'ignored' } })
  assert.ok(v.ok, v.error)
  assert.equal(v.board.recipient, null)
})

test('creating an Event board stores an empty, idle wheel that guests can read', async () => {
  const made = await newBoard(owner.cookie, EVENT)
  assert.equal(made.status, 200)
  const code = made.data.code
  const mine = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: owner.cookie })
  assert.equal(mine.data.board.type, 'event')
  assert.equal(mine.data.board.wheel.round.state, 'idle')
  assert.deepEqual(mine.data.board.wheel.participants, [])
  assert.equal(mine.data.items.length, 0)
  const guest = await newGuest(code)
  const seen = await call(board.GET, 'GET', `/api/boards/${code}`, { code, cookie: guest.cookie })
  assert.equal(seen.data.board.wheel.round.state, 'idle')
  assert.ok(!('ownerId' in seen.data.board))
})

test('nothing can be drawn on an Event board', async () => {
  const code = (await newBoard(owner.cookie, EVENT)).data.code
  const op = { op: 'add', item: { id: 'n1', kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text: 'hi' } } }
  const r = await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: owner.cookie, body: { ops: [op] } })
  assert.equal(r.status, 200)
  assert.equal(r.data.applied.length, 0)
  assert.equal(r.data.rejected.length, 1)
  assert.ok(planOps({ type: 'event', status: 'open' }, new Map(), [{ ok: true, op }], { uid: 'x', isOwner: true }, 1).rejected.length)
})

test('the client keeps the wheel from a board message and ignores a malformed one', () => {
  const s0 = initialState({ board: { code: 'ABC234', type: 'event', title: 'T', wheel: { round: { state: 'idle' } } }, items: [], people: [] })
  const wheel = { round: { state: 'prizeChosen' }, participants: [] }
  const s1 = reducer(s0, { type: 'board', board: { wheel, updatedAt: 5 } })
  assert.deepEqual(s1.board.wheel, wheel)
  const s2 = reducer(s1, { type: 'board', board: { wheel: 'nope', updatedAt: 6 } })
  assert.deepEqual(s2.board.wheel, wheel)
})
