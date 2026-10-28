// Server-only: who may do what on a board. Every board route goes through authorize() (read or write) or
// requireOwner() (settings); nothing in a request body is ever trusted as proof of ownership.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { rtSecret } from './rt.js'
import { getSessionUser, requireJson, requireSameOrigin } from './auth.js'
import { getStore } from './store.js'
import { anonModeOf } from './anon.js'
import { isCode } from './ids.js'
import { readGuest, publicId } from './guest.js'
import { guestAiView, ownerAiView } from './aiBoard.js'
import { fail, stripBoard, readCookie, clientIp, windowHit, windowCount, tooMany, retryAfterSecs } from './http.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

// --- the passcode access cookie: rs_a_<code> = HMAC over the code and the passcode hash --------------------------
// The HMAC covers the whole stored hash (which embeds a fresh random salt), so setting, changing or clearing the
// passcode invalidates every cookie earned with the previous one. It is deliberately not bound to a guest uid.
const MAX_AGE_S = 30 * 24 * 3600

export const accessCookieName = (code) => `rs_a_${code}`
const accessSig = (board) => createHmac('sha256', rtSecret()).update(`access:${board.code}:${board.passcodeHash}`).digest('hex')

export function buildAccessCookie(board) {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${MAX_AGE_S}`]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return `${accessCookieName(board.code)}=${accessSig(board)}; ${attrs.join('; ')}`
}

export function hasAccessCookie(req, board) {
  if (typeof board?.passcodeHash !== 'string' || !board.passcodeHash) return false
  const got = readCookie(req, accessCookieName(board.code))
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(accessSig(board))
  return a.length === b.length && timingSafeEqual(a, b)
}

// --- authorization -----------------------------------------------------------------------------------------------
// -> { role: 'owner' | 'guest', user? }, or throws HttpError. The owner is the signed-in account whose id is the
// board's ownerId and always passes. A guest is refused, in this order, when the board is revoked (403), when it has
// a passcode and the request lacks the access cookie (401, so a client can prompt), and, for writes, when it is closed.
// Note: an SSE stream that is already open is not cut by a later revoke at once; /api/rt/stream ends every connection
// at its deadline (RT_STREAM_MAX_MS, 5 minutes by default, never past the token's expiry) and re-authorizes each connect.
const REMOVED_MESSAGE = 'You were removed from this board'
function isBanned(req, board) {
  if (!board.bans?.length) return false
  const uid = readGuest(req)
  return uid !== null && board.bans.includes(publicId(board.code, uid))
}

export async function authorize(req, board, { write = false, store = getStore() } = {}) {
  const user = await getSessionUser(req, { store })
  if (user && board.ownerId && user.id === board.ownerId) return { role: 'owner', user }
  if (isBanned(req, board)) throw new HttpError(403, REMOVED_MESSAGE) // removed by the owner (see ownerTools.js)
  if (board.revoked) throw new HttpError(403, 'This link was revoked')
  if (board.passcodeHash && !hasAccessCookie(req, board)) throw new HttpError(401, 'Passcode required')
  if (write && board.status === 'closed') throw new HttpError(403, 'Board is closed')
  return user ? { role: 'guest', user } : { role: 'guest' }
}

// The signed-in owner of `board`, or HttpError 401 (no session) / 403 (someone else).
export async function requireOwner(req, board, { store = getStore() } = {}) {
  const user = await getSessionUser(req, { store })
  if (!user) throw new HttpError(401, 'Sign in')
  if (!board.ownerId || user.id !== board.ownerId) throw new HttpError(403, 'Not the owner')
  return user
}

// What a viewer may see of a board: the owner's id and creator never go to anyone but the owner (a code must not
// reveal who owns the board), and neither does a draft summary or the AI settings (see aiBoard.js).
// `hasPasscode` tells the settings panel whether a passcode is on without ever carrying the hash.
export function viewerBoard(board, role) {
  const out = stripBoard(board)
  if (!out) return out
  out.hasPasscode = Boolean(board.passcodeHash)
  out.anonymousNotes = anonModeOf(board)
  if (role === 'owner') return ownerAiView(board, out)
  const { ownerId, createdBy, ...rest } = guestAiView(board, out) // eslint-disable-line no-unused-vars
  return rest
}

// --- probing limiter ----------------------------------------------------------------------------------------------
// The 6-character code is the only secret on an open board, so lookups that miss or are refused are metered per IP:
// 20 unknown codes a minute, and 200 denials of any kind (404/401/403) a minute. Successful reads are never counted,
// so polling clients are not throttled. Checked before the board lookup, recorded after a denial. This guards the
// board routes, rt/join and /api/join/[code], which share this budget so the two lookups cannot probe codes separately.
const MISS_NOT_FOUND = 20
const MISS_DENIED = 200
const MISS_WINDOW_MS = 60_000
const MISS_OPTS = { localFallback: true }

export async function missBlocked(req) {
  const ip = clientIp(req)
  const [notFound, denied] = await Promise.all([
    windowCount(`bmiss404:${ip}`, MISS_WINDOW_MS, MISS_OPTS),
    windowCount(`bmissdeny:${ip}`, MISS_WINDOW_MS, MISS_OPTS),
  ])
  return notFound >= MISS_NOT_FOUND || denied >= MISS_DENIED ? tooMany(retryAfterSecs(MISS_WINDOW_MS)) : null
}

export async function recordMiss(req, status) {
  if (status !== 404 && status !== 401 && status !== 403) return
  const ip = clientIp(req)
  await windowHit(`bmissdeny:${ip}`, MISS_WINDOW_MS, MISS_OPTS)
  if (status === 404) await windowHit(`bmiss404:${ip}`, MISS_WINDOW_MS, MISS_OPTS)
}

// --- route wrapper -----------------------------------------------------------------------------------------------
// boardRoute(handler, { mutating, json }) -> a Next route handler. It validates the code, loads the board (400/404),
// optionally applies the CSRF guards first (same-origin, and application/json unless `json: false`), meters probing
// (see above), and turns a thrown HttpError into the matching JSON error. handler(req, { code, board, store }).
export function boardRoute(handler, { mutating = false, json = true } = {}) {
  return async (req, ctx) => {
    try {
      if (mutating) {
        const blocked = requireSameOrigin(req) || (json && requireJson(req))
        if (blocked) return blocked
      }
      const { code } = await ctx.params
      if (!isCode(code)) return fail(400, 'invalid code')
      const limited = await missBlocked(req)
      if (limited) return limited
      const store = getStore()
      const board = await store.getBoard(code)
      if (!board) { await recordMiss(req, 404); return fail(404, 'Board not found') }
      return await handler(req, { code, board, store })
    } catch (e) {
      if (e instanceof HttpError) { await recordMiss(req, e.status); return fail(e.status, e.message) }
      throw e
    }
  }
}
