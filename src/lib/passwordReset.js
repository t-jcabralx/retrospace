// Server only: the one-time link that lets someone choose a new password. Only the SHA-256 of the token is stored, like
// sessions, so a copy of the database cannot be used to take over an account.
import { randomBytes } from 'node:crypto'
import { hashKey } from './hash.js'
import { renderEmail } from './emailLayout.js'

export const RESET_TTL_MS = 30 * 60_000
export const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/ // 32 random bytes, base64url

// A new link replaces any earlier one for the same account. -> the raw token (goes into the email, never stored).
export async function issueReset(store, userId, now = Date.now()) {
  await store.deleteResetsByUser(userId)
  const token = randomBytes(32).toString('base64url')
  await store.createReset({ tokenHash: hashKey(token), userId, createdAt: now, expiresAt: now + RESET_TTL_MS })
  return token
}

// Uses the link up (one try only), sets the password and signs the account out everywhere. -> true, or false when the
// link is unknown, expired or already used.
export async function redeemReset(store, token, passwordHash, now = Date.now()) {
  if (typeof token !== 'string' || !RESET_TOKEN_RE.test(token)) return false
  const reset = await store.takeReset(hashKey(token), now)
  if (!reset) return false
  if (!(await store.updateUserPassword(reset.userId, passwordHash, now))) return false
  await store.deleteSessionsByUser(reset.userId)
  await store.deleteResetsByUser(reset.userId)
  return true
}

// The address the link points at: NEXT_PUBLIC_SITE_URL only (a Host header can be forged, so it is never used in
// production). null when there is nothing safe to use, and then no email is sent.
export function resetOrigin(env = process.env, requestUrl = '') {
  const fixed = String(env.NEXT_PUBLIC_SITE_URL ?? '').trim()
  try { if (fixed) return new URL(fixed).origin } catch { /* fall through */ }
  if (env.NODE_ENV === 'production') return null
  try { return new URL(requestUrl).origin } catch { return null }
}

// The reset email: a button to the link (which works once, for RESET_TTL_MS), the link in full for clients that block buttons, and
// a plain "this wasn't me" line. The logo and footer links use the link's own address, so they always match the site that sent it.
export function resetEmail({ name, link }) {
  const minutes = RESET_TTL_MS / 60_000
  let origin = null
  try { origin = new URL(link).origin } catch { /* no logo, no footer links */ }
  const { html, text } = renderEmail({
    origin,
    preheader: `Choose a new password. The link works once and expires in ${minutes} minutes.`,
    title: 'Reset your password',
    paragraphs: [`Hi ${name},`, 'Someone asked to reset the password for your Retrospace account. Use the button below to choose a new one.'],
    button: { label: 'Choose a new password', url: link },
    note: `The link works once and expires in ${minutes} minutes.`,
    fallback: true,
    after: ["If this wasn't you, you can ignore this email: your password stays the same, and nobody can change it without this link.", 'Retrospace will never ask you for your password by email.'],
    footer: 'You are getting this because a password reset was requested for your Retrospace account.',
  })
  return { subject: 'Reset your Retrospace password', text, html }
}
