// Server only. Sends one email through Resend (RESEND_API_KEY), from the address in MAIL_FROM. Swapping the provider means
// changing this file alone: callers only see sendMail() and mailConfigured().
import { envValue } from './db.js'

const ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 8000

// Resend's own test sender: it needs no domain, but delivers only to the email the Resend account was opened with.
export const DEFAULT_FROM = 'Retrospace <onboarding@resend.dev>'

// { apiKey, from } when there is a key (MAIL_FROM is optional and falls back to the test sender), else null (then nothing is sent).
export function mailConfig(env = process.env) {
  const apiKey = envValue('RESEND_API_KEY', env)
  return apiKey ? { apiKey, from: envValue('MAIL_FROM', env) || DEFAULT_FROM } : null
}

export const mailConfigured = (env = process.env) => mailConfig(env) !== null

// The provider's short error class (e.g. validation_error, invalid_api_key), or null. Only that allow-listed token is kept: the
// message itself can name the recipient, so it is never read or logged.
const errorName = async (res) => {
  try { const j = await res.json(); return typeof j?.name === 'string' && /^[a-z_]{3,40}$/.test(j.name) ? j.name : null } catch { return null }
}

// -> { ok: true } or { ok: false, error }. Never throws, and never puts the address or the message in the error.
export async function sendMail({ to, subject, text, html, replyTo }, { config = mailConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (!config) return { ok: false, error: 'mail is not configured' }
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [to], subject, text, html, ...(replyTo && { reply_to: replyTo }) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { ok: true }
    const name = await errorName(res)
    return { ok: false, error: `the mail provider answered ${res.status}${name ? ` (${name})` : ''}`, status: res.status, ...(name && { reason: name }) }
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'the mail provider timed out' : 'the mail provider could not be reached' }
  }
}
