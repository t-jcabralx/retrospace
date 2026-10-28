import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoardWithRetry, createBoardWithStarter, CodeAllocationError } from '../src/lib/boards.js'
import { createMemoryStore } from '../src/lib/store.js'
import { stripBoard } from '../src/lib/http.js'
import { isCode } from '../src/lib/ids.js'

const dup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
const fakeStore = (failures, error = dup) => {
  const calls = []
  return {
    calls,
    async createBoard(board) {
      calls.push(board.code)
      if (calls.length <= failures) throw error()
      return { ...board, createdAt: 1 }
    },
  }
}
const codes = (list) => { let i = 0; return () => list[i++] }
const make = (code) => ({ code, title: 'T', ownerId: 'u_1' })

test('createBoardWithRetry: two duplicate-key failures still end with one board under a new code', async () => {
  const store = fakeStore(2)
  const board = await createBoardWithRetry(store, make, codes(['AAAAAA', 'BBBBBB', 'CCCCCC']))
  assert.equal(board.code, 'CCCCCC')
  assert.deepEqual(store.calls, ['AAAAAA', 'BBBBBB', 'CCCCCC'])
})

test('createBoardWithRetry: the first success returns immediately', async () => {
  const store = fakeStore(0)
  assert.equal((await createBoardWithRetry(store, make, codes(['AAAAAA']))).code, 'AAAAAA')
  assert.equal(store.calls.length, 1)
})

test('createBoardWithRetry: five duplicate-key failures throw, after exactly five tries', async () => {
  const store = fakeStore(99)
  await assert.rejects(createBoardWithRetry(store, make, codes(['A', 'B', 'C', 'D', 'E', 'F'])), (e) => e instanceof CodeAllocationError && /Could not allocate/.test(e.message))
  assert.equal(store.calls.length, 5)
})

test('createBoardWithRetry: the attempt limit is configurable', async () => {
  const store = fakeStore(99)
  await assert.rejects(createBoardWithRetry(store, make, codes(['A', 'B', 'C', 'D']), 2))
  assert.equal(store.calls.length, 2)
})

test('createBoardWithRetry: any other error is rethrown at once', async () => {
  const store = fakeStore(1, () => Object.assign(new Error('network down'), { code: 'ECONNRESET' }))
  await assert.rejects(createBoardWithRetry(store, make, codes(['A', 'B'])), /network down/)
  assert.equal(store.calls.length, 1)
  const plain = fakeStore(1, () => new Error('boom'))
  await assert.rejects(createBoardWithRetry(plain, make, codes(['A', 'B'])), /boom/)
})

test('createBoardWithRetry: uses newCode by default and builds each board from the code it was given', async () => {
  const store = createMemoryStore()
  const made = []
  const board = await createBoardWithRetry(store, (code) => { made.push(code); return make(code) })
  assert.ok(isCode(board.code))
  assert.deepEqual(made, [board.code])
  assert.equal((await store.getBoard(board.code)).ownerId, 'u_1')
})

test('createBoardWithRetry against the real memory store: a taken code is skipped', async () => {
  const store = createMemoryStore()
  await store.createBoard(make('AAAAAA'))
  const board = await createBoardWithRetry(store, make, codes(['AAAAAA', 'BBBBBB']))
  assert.equal(board.code, 'BBBBBB')
})

test('stripBoard removes passcodeHash and ownerKeyHash without mutating the input', () => {
  const board = { code: 'ABCDEF', title: 't', ownerId: 'u_1', passcodeHash: 'scrypt$1$2$3$s$h', ownerKeyHash: 'legacy', status: 'open', revoked: false }
  const out = stripBoard(board)
  assert.equal('passcodeHash' in out, false)
  assert.equal('ownerKeyHash' in out, false)
  assert.deepEqual(out, { code: 'ABCDEF', title: 't', ownerId: 'u_1', status: 'open', revoked: false })
  assert.equal(board.passcodeHash, 'scrypt$1$2$3$s$h')
  assert.equal(stripBoard(null), null)
})

const starterOp = { op: 'add', id: 's1', item: { id: 's1', kind: 'text', x: 0, y: 0, data: { text: 'hi' } } }
const actor = { uid: 'KM-2222-3333-4444', name: 'Ann', isOwner: true }

test('createBoardWithStarter writes the starter items after creating the board', async () => {
  const store = createMemoryStore()
  const board = await createBoardWithStarter(store, make, [starterOp], actor, codes(['AAAAAA']))
  assert.equal(board.code, 'AAAAAA')
  assert.deepEqual((await store.listItems('AAAAAA')).map((i) => i.id), ['s1'])
  const empty = await createBoardWithStarter(store, make, [], actor, codes(['BBBBBB']))
  assert.equal((await store.listItems(empty.code)).length, 0)
})

test('createBoardWithStarter deletes the board and rethrows when the starter items cannot be written', async () => {
  const deleted = []
  const store = {
    createBoard: async (b) => ({ ...b }),
    applyOps: async () => { throw new Error('disk full') },
    deleteBoard: async (code) => { deleted.push(code) },
  }
  await assert.rejects(createBoardWithStarter(store, make, [starterOp], actor, codes(['AAAAAA'])), /disk full/)
  assert.deepEqual(deleted, ['AAAAAA'])
  // even a failing cleanup does not hide the original error
  const worse = { ...store, deleteBoard: async () => { throw new Error('cleanup failed') } }
  await assert.rejects(createBoardWithStarter(worse, make, [starterOp], actor, codes(['AAAAAA'])), /disk full/)
})

test('createBoardWithStarter surfaces CodeAllocationError without writing anything', async () => {
  const store = { ...fakeStore(99), applyOps: async () => assert.fail('must not be called'), deleteBoard: async () => assert.fail('nothing to delete') }
  await assert.rejects(createBoardWithStarter(store, make, [starterOp], actor, codes(['A', 'B', 'C', 'D', 'E'])), CodeAllocationError)
})
