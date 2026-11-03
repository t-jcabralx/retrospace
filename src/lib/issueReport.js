// Server only: a problem report from a visitor, checked and turned into an email to the site's owner.
import { checkEmail } from './validate.js'
import { stripControl } from './ids.js'
import { CONTACT } from '../ui/legal/legalData.js'
import { MIN_REPORT, MAX_REPORT } from './issueLimits.js'
import { renderEmail } from './emailLayout.js'
import { resetOrigin } from './passwordReset.js'

export { MIN_REPORT, MAX_REPORT } from './issueLimits.js'

// -> { ok, value: { message, email? } } or { ok: false, error }. The reply address is optional; when given it must be valid.
export function validateReport(body) {
  if (body === null || typeof body !== 'object') return { ok: false, error: 'body must be an object' }
  const message = typeof body.message === 'string' ? stripControl(body.message).trim() : ''
  if (message.length < MIN_REPORT) return { ok: false, error: `Describe the problem in at least ${MIN_REPORT} characters` }
  if (message.length > MAX_REPORT) return { ok: false, error: `Keep it under ${MAX_REPORT} characters` }
  const raw = typeof body.email === 'string' ? body.email.trim() : ''
  if (!raw) return { ok: true, value: { message } }
  const email = checkEmail(raw)
  return email.ok ? { ok: true, value: { message, email: email.value } } : { ok: false, error: 'That email address does not look right' }
}

// Where reports go: ISSUE_EMAIL_TO, else the contact address from the legal pages.
export const issueRecipient = (env = process.env) => String(env.ISSUE_EMAIL_TO ?? '').trim() || CONTACT

// The email the owner gets: the report in a quote box, who to reply to, and (when they left an address) a Reply button. The reply
// goes to the visitor through the email's reply-to, so answering from the inbox works too.
export function issueEmail({ message, email }, { origin = resetOrigin(), now = Date.now() } = {}) {
  const when = new Date(now).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const who = email ? `Reply to: ${email}` : 'The visitor left no email address.'
  const { html, text } = renderEmail({
    origin,
    preheader: message.replace(/\s+/g, ' ').slice(0, 90),
    title: 'New issue report',
    paragraphs: [`Received ${when}.`, { quote: message }, who],
    button: email ? { label: `Reply to ${email}`, url: `mailto:${email}` } : null,
    footer: 'Sent by the Report an issue form on your Retrospace site.',
  })
  return { subject: 'Retrospace issue report', text, html, ...(email && { replyTo: email }) }
}
