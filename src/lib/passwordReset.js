// Server only: the one-time link that lets someone choose a new password. Only the SHA-256 of the token is stored, like
// sessions, so a copy of the database cannot be used to take over an account.
import { randomBytes } from 'node:crypto'
import { hashKey } from './hash.js'

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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function resetEmail({ name, link }) {
  const minutes = RESET_TTL_MS / 60_000
  const text = `Hi ${name},\n\nSomeone asked to reset the password for your Retrospace account. To choose a new one, open this link within ${minutes} minutes:\n\n${link}\n\nIf this wasn't you, ignore this email. Your password stays the same.\n`
  const html = `<p>Hi ${escapeHtml(name)},</p><p>Someone asked to reset the password for your Retrospace account. To choose a new one, use the button below within ${minutes} minutes.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Choose a new password</a></p><p>Or paste this link into your browser:<br>${escapeHtml(link)}</p><p>If this wasn't you, ignore this email. Your password stays the same.</p>`
  return { subject: 'Reset your Retrospace password', text, html }
}
