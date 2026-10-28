// Server-only: sessions, cookies and the CSRF guards for mutating auth routes.
import { randomBytes } from 'node:crypto'
import { hashKey } from './hash.js'
import { getStore } from './store.js'
import { fail } from './http.js'

export const SESSION_COOKIE = 'rs_session'
const MAX_AGE_S = 30 * 24 * 3600
const SESSION_MS = MAX_AGE_S * 1000
const TOUCH_EVERY_MS = 3600 * 1000
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/ // 32 random bytes, base64url

export const newUserId = () => `u_${randomBytes(8).toString('hex')}`
export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name })

function cookieAttrs(maxAge) {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; ${cookieAttrs(0)}`

// Only the SHA-256 of the token is stored; the raw token lives in the cookie alone.
export async function createSessionFor(userId, now = Date.now(), store = getStore()) {
  const token = randomBytes(32).toString('base64url')
  await store.createSession({ tokenHash: hashKey(token), userId, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_MS })
  return { token, cookie: `${SESSION_COOKIE}=${token}; ${cookieAttrs(MAX_AGE_S)}` }
}

// The raw session token from the request, or null if the header is missing or not a well-formed token.
export function sessionToken(req) {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    return TOKEN_RE.test(value) ? value : null
  }
  return null
}

export async function getSessionUser(req, { store = getStore(), now = Date.now() } = {}) {
  const token = sessionToken(req)
  if (!token) return null
  const tokenHash = hashKey(token)
  const session = await store.getSessionByTokenHash(tokenHash, now)
  if (!session) return null
  const user = await store.getUserById(session.userId)
  if (!user) return null
  if (now - session.lastSeenAt >= TOUCH_EVERY_MS) {
    try {
      await store.touchSession(tokenHash, now)
    } catch (e) {
      console.error('retrospace: session touch failed:', e?.message) // best effort; never fail the request
    }
  }
  return publicUser(user)
}

// null when OK, else the 415 response.
export function requireJson(req) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  return type === 'application/json' ? null : fail(415, 'Content-Type must be application/json')
}

// null when the Origin header is absent or names this host, else the 403 response.
export function requireSameOrigin(req) {
  const origin = req.headers.get('origin')
  if (origin === null) return null
  let host
  try { host = new URL(origin).host } catch { return fail(403, 'Cross-origin request blocked') }
  const own = [req.headers.get('host'), req.headers.get('x-forwarded-host')?.split(',')[0].trim(), new URL(req.url).host]
  return own.includes(host) ? null : fail(403, 'Cross-origin request blocked')
}

export function noStore(res) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export function withCookie(res, cookie) {
  res.headers.append('Set-Cookie', cookie)
  return res
}
