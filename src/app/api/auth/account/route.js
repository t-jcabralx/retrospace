import { getStore } from '../../../../lib/store.js'
import { verifyPassword } from '../../../../lib/password.js'
import { deleteAccount } from '../../../../lib/account.js'
import { json, fail, parseBody, rateLimited, windowHit, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, getSessionUser, clearSessionCookie, noStore, withCookie } from '../../../../lib/auth.js'

export const runtime = 'nodejs'
const FAILS = 5
const WINDOW_MS = 15 * 60_000

// Deletes the signed-in owner's account, boards, templates and sign-ins. The password is asked for again, so a session
// left open on a shared computer cannot erase everything, and wrong guesses are limited.
async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'delacct', 10, { localFallback: true })) return tooMany(retryAfterSecs(60_000))
  const store = getStore()
  const session = await getSessionUser(req, { store })
  if (!session) return fail(401, 'Sign in')
  const [body, bad] = await parseBody(req, { max: 2048 })
  if (bad) return bad
  if (typeof body.password !== 'string' || !body.password) return fail(400, 'Enter your password to confirm')
  const user = await store.getUserById(session.id)
  if (!user) return fail(401, 'Sign in')
  if (await verifyPassword(body.password, user.passwordHash)) {
    const { boards } = await deleteAccount(store, user)
    return withCookie(json({ ok: true, boards }), clearSessionCookie())
  }
  if ((await windowHit(`delacctfail:${user.id}`, WINDOW_MS, { localFallback: true, credential: true })) > FAILS) return tooMany(retryAfterSecs(WINDOW_MS), 'Too many attempts, try again later')
  return fail(403, 'That password is not right')
}

export async function DELETE(req) {
  return noStore(await handle(req))
}
