import { requireOwner, boardRoute } from '../../../../../../lib/access.js'
import { json, fail, rateLimited } from '../../../../../../lib/http.js'
import { noStore } from '../../../../../../lib/auth.js'
import { isUid } from '../../../../../../lib/ids.js'
import { publish } from '../../../../../../lib/rt.js'
import { publicIdForUser } from '../../../../../../lib/guest.js'
import { forgetBoard } from '../../../../../../lib/boardCache.js'
import { forgetParticipant } from '../../../../../../lib/participants.js'
import { viewerItems } from '../../../../../../lib/anon.js'
import { kickedEnvelope, tombstonesEnvelope } from '../../../../../../lib/ownerTools.js'

export const runtime = 'nodejs'

// Owner removes a participant: DELETE .../participants/<public id>?items=1|0. `[id]` is the per-board PUBLIC id, never a
// cookie uid. The row is deleted (the name is free again), the id is banned (authorize() then refuses it everywhere),
// their open stream is told to stop with a { t:'kicked', id } envelope and, with items=1, their live items are
// tombstoned and published like any other ops. Nothing identifying (cookie uids) goes into either envelope.
// Limit: a banned browser can come back by clearing its cookies; combine removal with a passcode change or a revoke.
async function remove(req, { code, board, store, id }) {
  const user = await requireOwner(req, board)
  if (!isUid(id)) return fail(400, 'invalid id')
  const flag = new URL(req.url).searchParams.get('items')
  if (flag !== null && flag !== '0' && flag !== '1') return fail(400, 'items must be 0 or 1')
  const ownerId = publicIdForUser(code, user.id)
  if (id === ownerId) return fail(400, 'You cannot remove yourself')
  const person = await store.getParticipant(code, id)
  if (person?.kind === 'account') return fail(400, 'You cannot remove the owner')
  if (!person && !board.bans?.includes(id)) return fail(404, 'Participant not found')
  let result
  try {
    result = await store.removeParticipant(code, id, { deleteItems: flag === '1' })
  } catch (e) {
    if (e?.code === 'BANS_FULL') return fail(409, e.message)
    throw e
  }
  if (!result) return fail(404, 'Board not found')
  forgetBoard(code) // /api/rt/send reads the board (and its bans) through a short cache
  forgetParticipant(code, id)
  if (result.changed.length) await publish(code, tombstonesEnvelope(ownerId, result.changed))
  await publish(code, kickedEnvelope(ownerId, id))
  // `changed`: the tombstones, for the owner's own tab (it skips the echo of its own ops)
  return noStore(json({ removed: true, itemsDeleted: result.changed.length, changed: viewerItems(result.changed) }))
}

export async function DELETE(req, ctx) {
  if (await rateLimited(req, 'kick', 60, { localFallback: true })) return fail(429, 'slow down')
  const { id } = await ctx.params
  return boardRoute((r, c) => remove(r, { ...c, id }), { mutating: true, json: false })(req, ctx)
}
