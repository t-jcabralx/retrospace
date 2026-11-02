// What the separate realtime server may ask the website, and how the website knows the question came from it. The realtime server holds no
// database credentials; for each person who connects it asks "who is this, and what may they do on this board?" here, signed with
// REALTIME_SECRET (the realtime backend's own secret, never RT_SECRET). Pure helpers; the route is app/api/rt/authorize.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { realtimeSecret } from './rt.js'
import { publicIdForUser } from './guest.js'

export const AUTH_WINDOW_MS = 60_000

// Namespace 'rtauth:' : and under a different secret from every other signature on the site.
export const authorizeSignature = (ts, code, uid, secret = realtimeSecret()) => createHmac('sha256', secret).update(`rtauth:${ts}:${code}:${uid}`).digest('hex')

export function verifyAuthorize({ ts, sig, code, uid }, now = Date.now(), secret = realtimeSecret()) {
  const t = Number(ts)
  if (!secret || !Number.isSafeInteger(t) || Math.abs(now - t) > AUTH_WINDOW_MS || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false
  const a = Buffer.from(authorizeSignature(t, code, uid, secret))
  const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

// The facts the realtime server applies its rules with. `persona`: the person's stored name and avatar (null when they never chose one).
export function realtimeFacts({ board, persona, code, uid }) {
  const owner = Boolean(board.ownerId && uid === publicIdForUser(code, board.ownerId))
  return {
    persona: persona ? { name: persona.name, avatar: persona.avatar } : null,
    owner,
    revoked: Boolean(board.revoked),
    banned: Boolean(board.bans?.includes(uid)),
    readOnly: board.status !== 'open' || Boolean(board.locked),
    throwables: { enabled: Boolean(board.throwables?.enabled), emojis: Array.isArray(board.throwables?.emojis) ? [...board.throwables.emojis] : [] },
  }
}
