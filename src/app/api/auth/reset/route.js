import { getStore } from '../../../../lib/store.js'
import { MIN_PASSWORD, MAX_PASSWORD } from '../../../../lib/validate.js'
import { hashPassword } from '../../../../lib/password.js'
import { json, fail, parseBody, rateLimited, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, noStore } from '../../../../lib/auth.js'
import { redeemReset, RESET_TOKEN_RE } from '../../../../lib/passwordReset.js'

export const runtime = 'nodejs'

const OPTS = { localFallback: true }
const GONE = 'This link has expired or was already used. Ask for a new one.'

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'reset', 10, OPTS)) return tooMany(retryAfterSecs(60_000), 'Too many attempts, try again later')
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  const { token, password } = body ?? {}
  if (typeof token !== 'string' || !RESET_TOKEN_RE.test(token)) return fail(400, GONE)
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return fail(400, `password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`)
  }
  // The link is used up inside redeemReset, so a wrong guess costs nothing but the attempt limit above.
  const ok = await redeemReset(getStore(), token, await hashPassword(password))
  return ok ? json({ ok: true }) : fail(400, GONE)
}

export async function POST(req) {
  return noStore(await handle(req))
}
