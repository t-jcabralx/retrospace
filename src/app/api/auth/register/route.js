import { getStore } from '../../../../lib/store.js'
import { validateRegister } from '../../../../lib/validate.js'
import { hashPassword } from '../../../../lib/password.js'
import { json, fail, parseBody, rateLimited, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, createSessionFor, newUserId, publicUser, noStore, withCookie } from '../../../../lib/auth.js'

export const runtime = 'nodejs'

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'register', 10, { localFallback: true })) {
    return tooMany(retryAfterSecs(60_000), 'Too many attempts, try again later')
  }
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  const v = validateRegister(body)
  if (!v.ok) return fail(400, v.error)
  const { email, name, password } = v.value

  const store = getStore()
  if (await store.getUserByEmail(email)) return fail(409, 'Email already registered') // skip the scrypt for a known email
  let user
  try {
    user = await store.createUser({ id: newUserId(), email, name, passwordHash: await hashPassword(password), createdAt: Date.now() })
  } catch (e) {
    if (e?.code === 11000) return fail(409, 'Email already registered') // lost a race with another registration
    throw e
  }
  const { cookie } = await createSessionFor(user.id, Date.now(), store)
  return withCookie(json({ user: publicUser(user) }), cookie)
}

export async function POST(req) {
  return noStore(await handle(req))
}
