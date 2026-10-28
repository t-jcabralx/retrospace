import { getStore } from '../../../../lib/store.js'
import { getRedis } from '../../../../lib/db.js'
import { signTok } from '../../../../lib/rt.js'
import { authorize, HttpError, missBlocked, recordMiss } from '../../../../lib/access.js'
import { boardId } from '../../../../lib/guest.js'
import { resolvePersona } from '../../../../lib/participants.js'
import { isCode } from '../../../../lib/ids.js'
import { json, fail, parseBody, rateLimited, windowHit, tooMany, retryAfterSecs } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, noStore } from '../../../../lib/auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IP_PER_MIN = 600
const ID_PER_MIN = 300 // per board public id, so a whole room on one venue Wi-Fi address can join

// Membership token for /send and /stream, issued only for the caller's own identity on this board. The id comes from the
// signed rs_g cookie as the board's public id (a uid in the body is ignored), or from the session for the owner, and the
// caller must already have a persona. `live` tells the client whether to open the stream or poll.
// The token expires after 30 minutes, so a withdrawn guest loses /send within that time. /stream re-checks board access
// (revoked, passcode cookie) every time it connects, and also ends an open connection at the stream deadline
// (RT_STREAM_MAX_MS, default 5 minutes, never past the token's expiry), so a revoke bites at the next reconnect at the
// latest. The client refreshes this token every 20 minutes and drops to polling if that is refused.
async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'join', IP_PER_MIN)) return tooMany(retryAfterSecs(60_000)) // only a ceiling per address; the real limit is per person below
  const [body, bad] = await parseBody(req, { max: 4 * 1024 })
  if (bad) return bad
  if (!isCode(body.code)) return fail(400, 'invalid code')
  const limited = await missBlocked(req)
  if (limited) return limited
  const store = getStore()
  const board = await store.getBoard(body.code)
  if (!board) { await recordMiss(req, 404); return fail(404, 'Board not found') }
  let viewer
  try {
    viewer = await authorize(req, board)
  } catch (e) {
    if (e instanceof HttpError) { await recordMiss(req, e.status); return fail(e.status, e.message) }
    throw e
  }
  const uid = boardId(req, body.code, viewer)
  if (!uid) return fail(401, 'Join the board first')
  if ((await windowHit(`joinid:${uid}`, 60_000)) > ID_PER_MIN) return tooMany(retryAfterSecs(60_000))
  if (!(await resolvePersona(store, body.code, uid, viewer))) return fail(409, 'Choose a name first')
  return json({ tok: signTok(body.code, uid), live: !!getRedis() })
}

export async function POST(req) {
  return noStore(await handle(req))
}
