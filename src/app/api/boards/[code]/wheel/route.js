import { randomInt } from 'node:crypto'
import { authorize, boardRoute, viewerBoard } from '../../../../../lib/access.js'
import { boardId } from '../../../../../lib/guest.js'
import { applyAction, isRunner } from '../../../../../lib/wheel.js'
import { announce } from '../../../../../lib/summary.js'
import { isCid } from '../../../../../lib/ids.js'
import { json, fail, parseBody, windowHit, tooMany, retryAfterSecs } from '../../../../../lib/http.js'

export const runtime = 'nodejs'

const ACTIONS = ['spin-prize', 'spin-name', 'spin-winner', 'accept', 'skip', 'back', 'undo']
const PER_10_SECONDS = 12

// One step of the draw by the owner or a helper the owner named. The result is chosen HERE (crypto.randomInt); the screens
// only play it. The write is a compare-and-set on the board revision, so two people pressing at once start one spin and
// the other gets a 409 instead of a second, different result.
export const POST = boardRoute(async (req, { code, board, store }) => {
  if (board.type !== 'event' || !board.wheel) return fail(400, 'This board has no prize wheel')
  const viewer = await authorize(req, board, { write: true })
  const uid = boardId(req, code, viewer)
  if (!uid) return fail(401, 'Join the board first')
  if (!isRunner(board.wheel, uid, viewer.role === 'owner')) return fail(403, 'Only the host and helpers can run the draw')
  if ((await windowHit(`wheel:${uid}`, 10_000)) > PER_10_SECONDS) return tooMany(retryAfterSecs(10_000))
  const [body, bad] = await parseBody(req, { max: 2048 })
  if (bad) return bad
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  if (!ACTIONS.includes(body.action)) return fail(400, 'Unknown action')

  const result = applyAction(board.wheel, body.action, { now: Date.now(), pick: randomInt, by: uid })
  if (result.error) return fail(409, result.error)
  const updated = await store.casBoard(code, board.rev ?? 0, { wheel: result.wheel })
  if (!updated) return fail(409, 'Someone else just changed the draw. Look at the screen and try again')
  await announce(updated, body.cid)
  return json({ board: viewerBoard(updated, viewer.role) })
}, { mutating: true })
