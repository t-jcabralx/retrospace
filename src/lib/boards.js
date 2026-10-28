// Board creation helpers shared by the create route and its tests.
import { newCode } from './ids.js'

export class CodeAllocationError extends Error {
  constructor(max) {
    super(`Could not allocate a board code after ${max} tries`)
    this.name = 'CodeAllocationError'
  }
}

// Creates a board with a fresh code, retrying when the unique index reports a collision (Mongo E11000 / the memory
// store's equivalent). Any other error is rethrown at once; running out of tries throws CodeAllocationError.
// `makeBoard(code)` builds the document for a code.
export async function createBoardWithRetry(store, makeBoard, genCode = newCode, max = 5) {
  for (let i = 0; i < max; i++) {
    try {
      return await store.createBoard(makeBoard(genCode()))
    } catch (e) {
      if (e?.code !== 11000) throw e
    }
  }
  throw new CodeAllocationError(max)
}

// createBoardWithRetry, then the starter items. If the items cannot be written the board is deleted again (best
// effort) so no empty orphan is left behind, and the original error is rethrown. `actor` may be a function of the
// board code (an actor whose id is derived per board).
export async function createBoardWithStarter(store, makeBoard, ops, actor, genCode = newCode, max = 5) {
  const board = await createBoardWithRetry(store, makeBoard, genCode, max)
  if (ops.length) {
    try {
      await store.applyOps(board.code, ops, typeof actor === 'function' ? actor(board.code) : actor)
    } catch (e) {
      try { await store.deleteBoard(board.code) } catch { /* nothing more to do */ }
      throw e
    }
  }
  return board
}
