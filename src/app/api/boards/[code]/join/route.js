import { boardRoute, buildAccessCookie, HttpError } from '../../../../../lib/access.js'
import { verifyPassword } from '../../../../../lib/password.js'
import { json, fail, parseBody, rateLimited, windowHit, windowRefund, tooMany, retryAfterSecs } from '../../../../../lib/http.js'
import { getSessionUser, noStore, withCookie } from '../../../../../lib/auth.js'

export const runtime = 'nodejs'

const FAIL_LIMIT = 30
const FAIL_WINDOW_MS = 15 * 60_000
const TOO_MANY = 'Too many attempts, try again later'
const OPTS = { localFallback: true }
const FAIL_OPTS = { localFallback: true, credential: true }

// Exchanges the board passcode for the access cookie. A board without a passcode needs no cookie.
const handle = boardRoute(async (req, { code, board, store }) => {
  const user = await getSessionUser(req, { store })
  if (user && board.ownerId && user.id === board.ownerId) return json({ ok: true })
  if (board.revoked) throw new HttpError(403, 'This link was revoked')
  if (!board.passcodeHash) return json({ ok: true })

  const [body, bad] = await parseBody(req)
  if (bad) return bad
  // One slot per attempt, taken BEFORE the slow verification so concurrent guesses cannot all slip under the limit.
  // Keyed on the board so spreading guesses over many addresses does not help; a success
  // gives back the one slot it reserved (so a class joining with the right passcode is not locked out) but never
  // clears the counter, so it does not reset an attacker's budget.
  const failKey = `joinfail:${code}`
  if ((await windowHit(failKey, FAIL_WINDOW_MS, FAIL_OPTS)) > FAIL_LIMIT) return tooMany(retryAfterSecs(FAIL_WINDOW_MS), TOO_MANY)

  const ok = typeof body.passcode === 'string' && body.passcode.length <= 128 && await verifyPassword(body.passcode, board.passcodeHash)
  if (!ok) return fail(403, 'Wrong passcode')
  await windowRefund(failKey, FAIL_WINDOW_MS)
  return withCookie(json({ ok: true }), buildAccessCookie(board))
}, { mutating: true })

export async function POST(req, ctx) {
  if (await rateLimited(req, 'bjoin', 10, OPTS)) return noStore(tooMany(retryAfterSecs(60_000), TOO_MANY))
  return noStore(await handle(req, ctx))
}
