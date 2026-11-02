// Ephemeral messages (cursors, selection, live drags, hello, celebrate, throw): the rules for what may be relayed to a board's room.
// One place for them, used by the website's /api/rt/send and by the realtime (WebSocket) server, so both accept and refuse exactly the
// same things. Nothing here knows about HTTP or sockets: it returns a plain result.
import { getRedis } from './db.js'
import { rateOk, rateLocal } from './rt.js'
import { publicIdForUser } from './guest.js'
import { cachedParticipant } from './participants.js'
import { cachedBoard } from './boardCache.js'
import { windowHit } from './http.js'
import { throwWait } from './throwLimit.js'
import { MAX_EMOJI_UNITS } from './emoji.js'

const EFFECTS = new Set(['confetti', 'balloons', 'fireworks']) // the celebration effects the board themes use
const MAX_COORD = 1e6
const MAX_SEL = 100
const MAX_ID = 40
const MAX_DRAG_ITEMS = 20

const isCoord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD
const isDim = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_COORD
const isItemId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID

// Consumers (presence, cursors) must read the sender from the envelope's `from`, never from `msg`: there is no uid in msg.
// What each message type may carry. Anything else in `msg` is dropped, so a client can never relay a `uid`, `from` or
// `name` of its own; a field that is present but malformed makes the whole message invalid (null). hello and cursor get
// the sender's stored name and avatar added after this, by the handler.
export const CLEAN = {
  hello: () => ({ t: 'hello' }),
  typing: () => ({ t: 'typing' }),
  cursor: (m) => (isCoord(m.x) && isCoord(m.y) ? { t: 'cursor', x: m.x, y: m.y } : null),
  sel: (m) => (Array.isArray(m.ids) && m.ids.length <= MAX_SEL && m.ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= MAX_ID) ? { t: 'sel', ids: [...m.ids] } : null),
  // Live drag / resize steps: where the sender's items are right now. Relayed only, never stored (the drop is a normal write);
  // peers show them as a temporary position. `end` closes the gesture, `cancel` says the items go back where they were.
  drag: (m) => {
    if (m.end === true) {
      return Array.isArray(m.ids) && m.ids.length > 0 && m.ids.length <= MAX_DRAG_ITEMS && m.ids.every(isItemId)
        ? { t: 'drag', end: true, ...(m.cancel === true && { cancel: true }), ids: [...m.ids] } : null
    }
    if (!Array.isArray(m.items) || m.items.length === 0 || m.items.length > MAX_DRAG_ITEMS) return null
    if (m.q !== undefined && !(Number.isFinite(m.q) && m.q >= 0 && m.q <= 1e15)) return null
    const items = []
    for (const it of m.items) {
      if (it === null || typeof it !== 'object' || !isItemId(it.id) || !isCoord(it.x) || !isCoord(it.y)) return null
      if ((it.w !== undefined && !isDim(it.w)) || (it.h !== undefined && !isDim(it.h))) return null
      if (it.v !== undefined && !(Number.isFinite(it.v) && it.v >= 0 && it.v <= 1e15)) return null
      items.push({ id: it.id, x: it.x, y: it.y, ...(it.v !== undefined && { v: it.v }), ...(it.w !== undefined && { w: it.w }), ...(it.h !== undefined && { h: it.h }) })
    }
    return { t: 'drag', items, ...(m.q !== undefined && { q: m.q }) }
  },
  celebrate: (m) => (EFFECTS.has(m.effect) ? { t: 'celebrate', effect: m.effect } : null),
  // The board's own rules (is throwing on, is this emoji in its list) are checked by the handler.
  throw: (m) => {
    const emoji = typeof m.emoji === 'string' && m.emoji.length > 0 && m.emoji.length <= MAX_EMOJI_UNITS
    const item = m.itemId === undefined || (typeof m.itemId === 'string' && m.itemId.length > 0 && m.itemId.length <= MAX_ID)
    return emoji && item && isCoord(m.x) && isCoord(m.y) ? { t: 'throw', emoji: m.emoji, ...(m.itemId !== undefined && { itemId: m.itemId }), x: m.x, y: m.y } : null
  },
}
export const MAX_MSG_BYTES = 1024
export const MAX_DRAG_BYTES = 3 * 1024
export const PER_SECOND = 30
const CELEBRATE_GAP_MS = 3000 // one celebration per participant per window; the client also waits this long

// Celebrations take over every screen, so they get their own, much tighter budget, keyed by the token's public id.
// (A fixed window: two clicks straddling a window edge can land closer than 3 s, never more than two per window.)
const celebrateBlocked = async (msg, id) => msg.t === 'celebrate' && (await windowHit(`celebrate:${id}`, CELEBRATE_GAP_MS, { localFallback: true })) > 1

// Ephemeral messages (cursors, selection, ...): relayed to the room, never stored. Authorized by the signed token
// alone (it expires after 30 minutes, and was only ever issued for the guest's own cookie identity); a board read per
// message, up to 15 a second, would cost too much, so a withdrawn guest can send for at most the rest of their
// token's life. The sender's name and avatar are never taken from the client: `hello` and `cursor` messages carry the
// stored persona (read through a 15 s in-process cache, see participants.js), and every other type carries neither.

// -> { status, error?, retryAfter?, live?, envelope? }
//   status 200 with `envelope`: relay it. status 200 with `live: false`: nothing to relay to (no realtime configured).
//   otherwise `error` is the message for the sender and `retryAfter` (seconds) is set for a throttled throw.
// `msg` is what the client sent; `uid` and `cid` are already checked by the caller (token, ids). `rate`: 'shared' counts in Redis (one
// budget across servers, what the website uses), 'local' counts in this process (a long-lived server that holds the connection).
export async function relayEphemeral({ code, uid, cid, msg }, { store, redis = getRedis(), rate = 'shared' } = {}) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || !Object.hasOwn(CLEAN, msg.t)) return { status: 400, error: 'invalid msg' }
  if (Buffer.byteLength(JSON.stringify(msg)) > (msg.t === 'drag' ? MAX_DRAG_BYTES : MAX_MSG_BYTES)) return { status: 413, error: 'message too large' }
  const clean = CLEAN[msg.t](msg)
  if (!clean) return { status: 400, error: 'invalid msg' }

  let ok
  try {
    ok = rate === 'shared' && redis ? await rateOk(redis, uid, PER_SECOND) : rateLocal(uid, PER_SECOND)
  } catch {
    ok = rateLocal(uid, PER_SECOND) // Redis hiccup: do not drop the limiter
  }
  if (!ok) return { status: 429, error: 'slow down' }
  const throwing = msg.t === 'throw'
  if (!redis && !throwing) return (await celebrateBlocked(msg, uid)) ? { status: 429, error: 'Slow down' } : { status: 200, live: false } // nothing to relay to
  const persona = await cachedParticipant(store, code, uid)
  if (!persona) return { status: 403, error: 'not in room' }
  // Board state, from a 5 s cache. The owner is exempt (their public id comes from the board's ownerId); everybody else
  // is shut out of a revoked board, and may not celebrate or throw on one that is closed or locked.
  const board = await cachedBoard(store, code)
  if (!board) return { status: 403, error: 'not in room' }
  const isOwner = Boolean(board.ownerId && uid === publicIdForUser(code, board.ownerId))
  if (!isOwner) {
    if (board.revoked) return { status: 403, error: 'This link was revoked' }
    if (board.bans?.includes(uid)) return { status: 403, error: 'You were removed from this board' }
    if ((msg.t === 'celebrate' || msg.t === 'drag' || throwing) && (board.status !== 'open' || board.locked)) return { status: 403, error: 'Board is read-only' }
  }
  if (throwing) {
    // Everyone's rules, the owner's included. These checks come before the rate limit, so a refused throw costs no budget.
    if (!board.throwables?.enabled) return { status: 403, error: 'Throwing is off' }
    if (!board.throwables.emojis?.includes(clean.emoji)) return { status: 403, error: 'That emoji is not on the list' }
    const wait = await throwWait(uid)
    if (wait) return { status: 429, error: 'Slow down', retryAfter: wait }
    if (!redis) return { status: 200, live: false }
  }
  if (await celebrateBlocked(msg, uid)) return { status: 429, error: 'Slow down' } // after the checks above, so a refused celebrate costs no budget
  const stamped = msg.t === 'hello' || msg.t === 'cursor' || throwing ? { ...clean, name: persona.name, avatar: persona.avatar } : clean
  return { status: 200, envelope: { t: 'eph', from: uid, ...(cid && { cid }), msg: stamped } }
}
