import { getStore } from '../../../../lib/store.js'
import { validateLogin } from '../../../../lib/validate.js'
import { verifyPassword, dummyVerify } from '../../../../lib/password.js'
import { hashKey } from '../../../../lib/hash.js'
import { json, fail, parseBody, rateLimited, windowHit, windowClear, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, createSessionFor, publicUser, noStore, withCookie } from '../../../../lib/auth.js'

export const runtime = 'nodejs'

const TOO_MANY = 'Too many attempts, try again later'
const FAIL_LIMIT = 10
const FAIL_WINDOW_MS = 15 * 60_000
const OPTS = { localFallback: true }
const FAIL_OPTS = { localFallback: true, credential: true }

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'login', 10, OPTS)) return tooMany(retryAfterSecs(60_000), TOO_MANY)
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  const v = validateLogin(body)
  if (!v.ok) return fail(400, v.error)
  const { email, password } = v.value

  // One slot per attempt, reserved BEFORE the (slow) verification so concurrent guesses cannot all slip under the
  // limit. Counted for unknown emails too, and checked before the user lookup so a locked response is identical
  // for known and unknown accounts. Keyed on a hash so no address is stored in Redis.
  const failKey = `loginfail:${hashKey(email).slice(0, 32)}`
  if ((await windowHit(failKey, FAIL_WINDOW_MS, FAIL_OPTS)) > FAIL_LIMIT) return tooMany(retryAfterSecs(FAIL_WINDOW_MS), TOO_MANY)

  const store = getStore()
  const user = await store.getUserByEmail(email)
  const ok = user ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password)
  if (!ok) return fail(401, 'Invalid email or password')

  await windowClear(failKey, FAIL_WINDOW_MS) // a real sign-in gives the budget back
  const { cookie } = await createSessionFor(user.id, Date.now(), store)
  return withCookie(json({ user: publicUser(user) }), cookie)
}

export async function POST(req) {
  return noStore(await handle(req))
}
