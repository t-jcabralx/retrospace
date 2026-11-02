import { getStore } from '../../../../lib/store.js'
import { checkEmail } from '../../../../lib/validate.js'
import { hashKey } from '../../../../lib/hash.js'
import { json, fail, parseBody, rateLimited, windowHit, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, noStore } from '../../../../lib/auth.js'
import { mailConfig, sendMail } from '../../../../lib/mailer.js'
import { issueReset, resetOrigin, resetEmail } from '../../../../lib/passwordReset.js'
import { runAfter } from '../../../../lib/background.js'

export const runtime = 'nodejs'

const TOO_MANY = 'Too many attempts, try again later'
const PER_EMAIL = 3 // links per address per hour; more are quietly not sent, so the answer never tells who has an account
const EMAIL_WINDOW_MS = 60 * 60_000
const OPTS = { localFallback: true }

// The same answer whether or not the address has an account, whether or not mail is set up, and whatever the limits say.
const ANSWER = { ok: true }

async function sendLink(email, origin, store) {
  const config = mailConfig()
  if (!config || !origin) return
  if ((await windowHit(`forgotmail:${hashKey(email).slice(0, 32)}`, EMAIL_WINDOW_MS, OPTS)) > PER_EMAIL) return
  const user = await store.getUserByEmail(email)
  if (!user) return
  const token = await issueReset(store, user.id)
  const link = `${origin}/reset?token=${token}`
  const sent = await sendMail({ to: user.email, ...resetEmail({ name: user.name, link }) }, { config })
  if (!sent.ok) console.error('retrospace: password reset email not sent:', sent.error)
}

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'forgot', 5, OPTS)) return tooMany(retryAfterSecs(60_000), TOO_MANY)
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  const email = checkEmail(body?.email)
  if (!email.ok) return fail(400, email.error)

  // Looked up and sent after the answer has gone out, so a known address does not take visibly longer than an unknown one.
  const origin = resetOrigin(process.env, req.url)
  const store = getStore()
  await runAfter(() => sendLink(email.value, origin, store).catch((e) => console.error('retrospace: password reset failed:', e?.message)))
  return json(ANSWER)
}

export async function POST(req) {
  return noStore(await handle(req))
}
