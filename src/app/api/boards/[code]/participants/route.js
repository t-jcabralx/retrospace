import { requireOwner, boardRoute } from '../../../../../lib/access.js'
import { json, rateLimited, fail } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'
import { publicParticipant, MAX_PARTICIPANTS } from '../../../../../lib/participants.js'

export const runtime = 'nodejs'

// The owner's current people list (the settings drawer's People section refreshes it while it is open): the same public
// view the snapshot carries (per-board id, name, avatar, kind), nothing else, never a cookie uid or a ban.
const handle = boardRoute(async (req, { code, board, store }) => {
  await requireOwner(req, board)
  const all = await store.listParticipants(code)
  return noStore(json({ participants: all.slice(0, MAX_PARTICIPANTS + 1).map(publicParticipant) }))
})

export async function GET(req, ctx) {
  if (await rateLimited(req, 'people-list', 120, { localFallback: true })) return fail(429, 'slow down')
  return handle(req, ctx)
}
