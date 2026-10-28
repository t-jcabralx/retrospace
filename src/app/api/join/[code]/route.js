import { getStore } from '../../../../lib/store.js'
import { isCode } from '../../../../lib/ids.js'
import { missBlocked, recordMiss } from '../../../../lib/access.js'
import { json, fail, rateLimited, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { noStore } from '../../../../lib/auth.js'

export const runtime = 'nodejs'

// Public: what the join screen may show a stranger who typed a code. Nothing else about the board (no owner, items
// or recipient) leaves this route.
export async function GET(req, { params }) {
  if (await rateLimited(req, 'jinfo', 60, { localFallback: true })) return noStore(tooMany(retryAfterSecs(60_000)))
  const { code } = await params
  if (!isCode(code)) return noStore(fail(400, 'invalid code'))
  // Shares its miss budget with the board routes, so the two lookups cannot be used to probe codes separately.
  const limited = await missBlocked(req)
  if (limited) return noStore(limited)
  const board = await getStore().getBoard(code)
  if (!board) { await recordMiss(req, 404); return noStore(json({ exists: false }, 404)) }
  return noStore(json({
    exists: true,
    title: board.title,
    type: board.type,
    needsPasscode: !!board.passcodeHash,
    closed: board.status === 'closed',
    revoked: !!board.revoked,
  }))
}
