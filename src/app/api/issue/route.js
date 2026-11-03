import { json, fail, parseBody, rateLimited, windowHit, tooMany, retryAfterSecs } from '../../../lib/http.js'
import { requireJson, requireSameOrigin, noStore } from '../../../lib/auth.js'
import { mailConfig, sendMail } from '../../../lib/mailer.js'
import { validateReport, issueRecipient, issueEmail } from '../../../lib/issueReport.js'

export const runtime = 'nodejs'

const OPTS = { localFallback: true }
const PER_MINUTE = 3 // per visitor
const PER_DAY = 40 // for the whole site: a flood must not use up the mail provider's daily allowance
const DAY_MS = 24 * 3600_000

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'issue', PER_MINUTE, OPTS)) return tooMany(retryAfterSecs(60_000), 'Too many reports, try again later')
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  if (typeof body?.website === 'string' && body.website) return json({ ok: true }) // a hidden field only a bot fills in: act as if it was sent
  const v = validateReport(body)
  if (!v.ok) return fail(400, v.error)

  const config = mailConfig()
  if (!config) return fail(503, 'Reports are not available right now')
  if ((await windowHit('issue:day', DAY_MS, OPTS)) > PER_DAY) return tooMany(retryAfterSecs(DAY_MS), 'Too many reports today, try again tomorrow')
  const sent = await sendMail({ to: issueRecipient(), ...issueEmail(v.value) }, { config })
  if (!sent.ok) {
    console.error('retrospace: issue report not sent:', sent.error)
    return fail(502, 'Your report could not be sent. Please try again later')
  }
  return json({ ok: true })
}

export async function POST(req) {
  return noStore(await handle(req))
}
