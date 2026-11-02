// Server only. Sends one email through the configured provider: Resend (RESEND_API_KEY) or Brevo (BREVO_API_KEY), with the
// sender in MAIL_FROM. Callers only see sendMail() and mailConfigured(); a new provider is one more entry in PROVIDERS.
import { envValue } from './db.js'

const TIMEOUT_MS = 8000

// 'Retrospace <no-reply@example.com>' or a bare address -> { name?, email }
export function parseFrom(from) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/.exec(from)
  if (m) return { ...(m[1] && { name: m[1] }), email: m[2] }
  return { email: String(from).trim() }
}

const PROVIDERS = {
  resend: {
    key: 'RESEND_API_KEY',
    request: ({ apiKey, from }, { to, subject, text, html }) => ({
      url: 'https://api.resend.com/emails',
      headers: { authorization: `Bearer ${apiKey}` },
      body: { from, to: [to], subject, text, html },
    }),
  },
  brevo: { // free: 300 emails a day, and a single verified sender address is enough (no domain needed)
    key: 'BREVO_API_KEY',
    request: ({ apiKey, from }, { to, subject, text, html }) => ({
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': apiKey },
      body: { sender: parseFrom(from), to: [{ email: to }], subject, textContent: text, htmlContent: html },
    }),
  },
}

// { provider, apiKey, from } when a key and MAIL_FROM are both present, else null (then nothing is sent).
export function mailConfig(env = process.env) {
  const from = envValue('MAIL_FROM', env)
  if (!from) return null
  for (const [provider, p] of Object.entries(PROVIDERS)) {
    const apiKey = envValue(p.key, env)
    if (apiKey) return { provider, apiKey, from }
  }
  return null
}

export const mailConfigured = (env = process.env) => mailConfig(env) !== null

// -> { ok: true } or { ok: false, error }. Never throws, and never puts the address or the message in the error.
export async function sendMail(message, { config = mailConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (!config) return { ok: false, error: 'mail is not configured' }
  try {
    const { url, headers, body } = PROVIDERS[config.provider ?? 'resend'].request(config, message)
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? { ok: true } : { ok: false, error: `the mail provider answered ${res.status}` }
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'the mail provider timed out' : 'the mail provider could not be reached' }
  }
}
