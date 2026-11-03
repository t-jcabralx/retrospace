// Server only. Sends one email through Resend (RESEND_API_KEY), from the address in MAIL_FROM. Swapping the provider means
// changing this file alone: callers only see sendMail() and mailConfigured().
import { envValue } from './db.js'

const ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 8000

// { apiKey, from } when both settings are present, else null (then nothing is sent).
export function mailConfig(env = process.env) {
  const apiKey = envValue('RESEND_API_KEY', env)
  const from = envValue('MAIL_FROM', env)
  return apiKey && from ? { apiKey, from } : null
}

export const mailConfigured = (env = process.env) => mailConfig(env) !== null

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
    return res.ok ? { ok: true } : { ok: false, error: `the mail provider answered ${res.status}` }
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'the mail provider timed out' : 'the mail provider could not be reached' }
  }
}
