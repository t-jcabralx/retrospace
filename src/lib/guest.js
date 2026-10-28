// Server-only: the guest identity. A guest's uid is minted HERE and proved by a signed HttpOnly cookie
// (rs_g = '<uid>.<hmac>'); a uid typed into a request body or query proves nothing, because a client-chosen one
// could be claimed by anybody.
//
// The cookie uid is PRIVATE: it is global to the browser, so showing it would link one person across boards. Every
// board sees a PUBLIC id instead (publicId, an HMAC of the cookie uid and the board code, in the same KM-XXXX-XXXX-XXXX
// format). That id is what is stored (participants, authorUid, votes, reactions) and what is exposed (viewer.uid,
// participants[].uid, envelope `from`, the realtime token). The same browser has unrelated ids on different boards.
// A signed-in board OWNER is identified by their account instead (publicIdForUser), on every browser.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { rtSecret } from './rt.js'
import { newUid, isUid } from './ids.js'
import { readCookie } from './http.js'

export const GUEST_COOKIE = 'rs_g'
const MAX_AGE_S = 365 * 24 * 3600
const MAC_RE = /^[0-9a-f]{32}$/

const mac = (uid) => createHmac('sha256', rtSecret()).update(`guest:${uid}`).digest('hex').slice(0, 32)

function cookieFor(uid) {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${MAX_AGE_S}`]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return `${GUEST_COOKIE}=${uid}.${mac(uid)}; ${attrs.join('; ')}`
}

// The verified guest uid of the request, or null. Never throws.
export function readGuest(req) {
  try {
    const raw = readCookie(req, GUEST_COOKIE)
    if (!raw || raw.length > 80) return null
    const dot = raw.indexOf('.')
    if (dot < 0) return null
    const uid = raw.slice(0, dot)
    const got = raw.slice(dot + 1)
    if (!isUid(uid) || !MAC_RE.test(got)) return null
    const a = Buffer.from(got)
    const b = Buffer.from(mac(uid))
    return a.length === b.length && timingSafeEqual(a, b) ? uid : null
  } catch {
    return null
  }
}

export function mintGuest() {
  const uid = newUid()
  return { uid, cookie: cookieFor(uid) }
}

// The caller's guest uid, minting a new identity when the cookie is missing or invalid.
// -> { uid } for a valid cookie, { uid, setCookie } when a fresh one must be sent on the response.
export function ensureGuest(req) {
  const uid = readGuest(req)
  if (uid) return { uid }
  const { uid: fresh, cookie } = mintGuest()
  return { uid: fresh, setCookie: cookie }
}

// --- per-board public ids -----------------------------------------------------------------------------------------
// HMAC (namespace 'pid:', see rt.js) mapped onto the uid alphabet, 12 characters from the first 12 digest bytes. The
// modulo bias is irrelevant for an identifier (the digest is uniform and 31^12 is far beyond any collision risk).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
function idFrom(label) {
  const d = createHmac('sha256', rtSecret()).update(label).digest()
  let c = ''
  for (let i = 0; i < 12; i++) c += ALPHABET[d[i] % ALPHABET.length]
  return `KM-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`
}

// A guest's id on one board. Stable for (cookie uid, board), unrelated across boards.
export const publicId = (code, uid) => idFrom(`pid:${code}:${uid}`)
// A signed-in owner's id on their board: from the account, so every browser of theirs is the same participant, and a
// person on the same browser without the session cannot produce it.
export const publicIdForUser = (code, userId) => idFrom(`pid:${code}:user:${userId}`)

// The caller's public id on this board, or null for a guest without a valid cookie. `viewer` is what authorize()
// returned: the owner needs no cookie at all.
export function boardId(req, code, viewer) {
  if (viewer.role === 'owner') return publicIdForUser(code, viewer.user.id)
  const uid = readGuest(req)
  return uid ? publicId(code, uid) : null
}
