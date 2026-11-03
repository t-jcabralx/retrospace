// Server only: a problem report from a visitor, checked and turned into an email to the site's owner.
import { checkEmail } from './validate.js'
import { stripControl } from './ids.js'
import { CONTACT } from '../ui/legal/legalData.js'
import { MIN_REPORT, MAX_REPORT } from './issueLimits.js'

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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function issueEmail({ message, email }) {
  const from = email ? `Reply to: ${email}` : 'The visitor left no email address.'
  return {
    subject: 'Retrospace issue report',
    text: `${message}\n\n--\n${from}\n`,
    html: `<p style="white-space:pre-wrap">${escapeHtml(message)}</p><hr><p>${escapeHtml(from)}</p>`,
    ...(email && { replyTo: email }),
  }
}
