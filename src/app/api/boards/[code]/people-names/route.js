import { authorize, boardRoute } from '../../../../../lib/access.js'
import { json, fail, rateLimited } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'
import { guestPeople } from '../../../../../lib/wall.js'

export const runtime = 'nodejs'

// The names a guest may @mention on a team wall: [{ id, name }] and nothing else (birthdays and start dates stay the
// owner's, in the people list the snapshot sends to the owner only).
const handle = boardRoute(async (req, { code, board, store }) => {
  await authorize(req, board)
  if (board.type !== 'wall') return noStore(json([]))
  return noStore(json(guestPeople(await store.listPeople(code))))
})

export async function GET(req, ctx) {
  if (await rateLimited(req, 'people-names', 60, { localFallback: true })) return fail(429, 'slow down')
  return handle(req, ctx)
}
