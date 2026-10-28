import { authorize, boardRoute } from '../../../../../lib/access.js'
import { json, fail, rateLimited } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'
import { parseToday, milestonesOn } from '../../../../../lib/wall.js'

export const runtime = 'nodejs'

// Today's birthdays and work anniversaries for the viewer's calendar day (?today=YYYY-MM-DD). The people list itself
// (birthdays, start dates) never leaves the server for a guest; this is all they learn: who, which kind, how many years.
const handle = boardRoute(async (req, { code, board, store }) => {
  await authorize(req, board)
  const parsed = parseToday(new URL(req.url).searchParams.get('today'))
  if (!parsed.ok) return fail(400, parsed.error)
  if (board.type !== 'wall') return noStore(json([]))
  return noStore(json(milestonesOn(await store.listPeople(code), parsed)))
})

export async function GET(req, ctx) {
  if (await rateLimited(req, 'milestones', 60, { localFallback: true })) return fail(429, 'slow down')
  return handle(req, ctx)
}
