import { getRedis } from '../../../../lib/db.js'
import { publish, verifyTok, rateOk, rateLocal } from '../../../../lib/rt.js'
import { isCode, isUid, isCid } from '../../../../lib/ids.js'
import { getStore } from '../../../../lib/store.js'
import { cachedParticipant } from '../../../../lib/participants.js'
import { cachedBoard } from '../../../../lib/boardCache.js'
import { publicIdForUser } from '../../../../lib/guest.js'
import { json, fail, parseBody, windowHit, tooMany } from '../../../../lib/http.js'
import { throwWait } from '../../../../lib/throwLimit.js'
import { MAX_EMOJI_UNITS } from '../../../../lib/emoji.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EFFECTS = new Set(['confetti', 'balloons', 'fireworks']) // the celebration effects the board themes use
const MAX_COORD = 1e6
const MAX_SEL = 100
const MAX_ID = 40

const isCoord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD

// Consumers (presence, cursors) must read the sender from the envelope's `from`, never from `msg`: there is no uid in msg.
// What each message type may carry. Anything else in `msg` is dropped, so a client can never relay a `uid`, `from` or
// `name` of its own; a field that is present but malformed makes the whole message invalid (null). hello and cursor get
// the sender's stored name and avatar added after this, by the handler.
const CLEAN = {
  hello: () => ({ t: 'hello' }),
  typing: () => ({ t: 'typing' }),
  cursor: (m) => (isCoord(m.x) && isCoord(m.y) ? { t: 'cursor', x: m.x, y: m.y } : null),
  sel: (m) => (Array.isArray(m.ids) && m.ids.length <= MAX_SEL && m.ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= MAX_ID) ? { t: 'sel', ids: [...m.ids] } : null),
  celebrate: (m) => (EFFECTS.has(m.effect) ? { t: 'celebrate', effect: m.effect } : null),
  // The board's own rules (is throwing on, is this emoji in its list) are checked by the handler.
  throw: (m) => {
    const emoji = typeof m.emoji === 'string' && m.emoji.length > 0 && m.emoji.length <= MAX_EMOJI_UNITS
    const item = m.itemId === undefined || (typeof m.itemId === 'string' && m.itemId.length > 0 && m.itemId.length <= MAX_ID)
    return emoji && item && isCoord(m.x) && isCoord(m.y) ? { t: 'throw', emoji: m.emoji, ...(m.itemId !== undefined && { itemId: m.itemId }), x: m.x, y: m.y } : null
  },
}
const MAX_MSG_BYTES = 1024
const PER_SECOND = 30
const CELEBRATE_GAP_MS = 3000 // one celebration per participant per window; the client also waits this long

// Celebrations take over every screen, so they get their own, much tighter budget, keyed by the token's public id.
// (A fixed window: two clicks straddling a window edge can land closer than 3 s, never more than two per window.)
const celebrateBlocked = async (msg, id) => msg.t === 'celebrate' && (await windowHit(`celebrate:${id}`, CELEBRATE_GAP_MS, { localFallback: true })) > 1

// Ephemeral messages (cursors, selection, ...): relayed to the room, never stored. Authorized by the signed token
// alone (it expires after 30 minutes, and was only ever issued for the guest's own cookie identity); a board read per
// message, up to 15 a second, would cost too much, so a withdrawn guest can send for at most the rest of their
// token's life. The sender's name and avatar are never taken from the client: `hello` and `cursor` messages carry the
// stored persona (read through a 15 s in-process cache, see participants.js), and every other type carries neither.
export async function POST(req) {
  const [body, bad] = await parseBody(req, { max: 4 * 1024 })
  if (bad) return bad
  if (!isCode(body.code)) return fail(400, 'invalid code')
  if (!isUid(body.uid)) return fail(400, 'invalid uid')
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  if (!verifyTok(body.code, body.uid, body.tok)) return fail(403, 'not in room')
  const msg = body.msg
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || !Object.hasOwn(CLEAN, msg.t)) return fail(400, 'invalid msg')
  if (Buffer.byteLength(JSON.stringify(msg)) > MAX_MSG_BYTES) return fail(413, 'message too large')
  const clean = CLEAN[msg.t](msg)
  if (!clean) return fail(400, 'invalid msg')

  const redis = getRedis()
  let ok
  try {
    ok = redis ? await rateOk(redis, body.uid, PER_SECOND) : rateLocal(body.uid, PER_SECOND)
  } catch {
    ok = rateLocal(body.uid, PER_SECOND) // Redis hiccup: do not drop the limiter
  }
  if (!ok) return fail(429, 'slow down')
  const throwing = msg.t === 'throw'
  if (!redis && !throwing) return (await celebrateBlocked(msg, body.uid)) ? fail(429, 'Slow down') : json({ ok: true, live: false }) // nothing to relay to
  const persona = await cachedParticipant(getStore(), body.code, body.uid)
  if (!persona) return fail(403, 'not in room')
  // Board state, from a 5 s cache. The owner is exempt (their public id comes from the board's ownerId); everybody else
  // is shut out of a revoked board, and may not celebrate or throw on one that is closed or locked.
  const board = await cachedBoard(getStore(), body.code)
  if (!board) return fail(403, 'not in room')
  const isOwner = Boolean(board.ownerId && body.uid === publicIdForUser(body.code, board.ownerId))
  if (!isOwner) {
    if (board.revoked) return fail(403, 'This link was revoked')
    if (board.bans?.includes(body.uid)) return fail(403, 'You were removed from this board')
    if ((msg.t === 'celebrate' || throwing) && (board.status !== 'open' || board.locked)) return fail(403, 'Board is read-only')
  }
  if (throwing) {
    // Everyone's rules, the owner's included. These checks come before the rate limit, so a refused throw costs no budget.
    if (!board.throwables?.enabled) return fail(403, 'Throwing is off')
    if (!board.throwables.emojis?.includes(clean.emoji)) return fail(403, 'That emoji is not on the list')
    const wait = await throwWait(body.uid)
    if (wait) return tooMany(wait, 'Slow down')
    if (!redis) return json({ ok: true, live: false })
  }
  if (await celebrateBlocked(msg, body.uid)) return fail(429, 'Slow down') // after the checks above, so a refused celebrate costs no budget
  const stamped = msg.t === 'hello' || msg.t === 'cursor' || throwing ? { ...clean, name: persona.name, avatar: persona.avatar } : clean
  await publish(body.code, { t: 'eph', from: body.uid, ...(body.cid && { cid: body.cid }), msg: stamped }, redis)
  return json({ ok: true })
}
