import { getRedis } from '../../../../lib/db.js'
import { publish, verifyTok } from '../../../../lib/rt.js'
import { isCode, isUid, isCid } from '../../../../lib/ids.js'
import { getStore } from '../../../../lib/store.js'
import { json, fail, parseBody, tooMany } from '../../../../lib/http.js'
import { relayEphemeral } from '../../../../lib/ephemeral.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ephemeral messages (cursors, selection, ...): relayed to the room, never stored. Authorized by the signed token
// alone (it expires after 30 minutes, and was only ever issued for the guest's own cookie identity); a board read per
// message, up to 15 a second, would cost too much, so a withdrawn guest can send for at most the rest of their
// token's life. The sender's name and avatar are never taken from the client: `hello` and `cursor` messages carry the
// stored persona (read through a 15 s in-process cache, see participants.js), and every other type carries neither.
// The rules themselves live in lib/ephemeral.js, shared with the realtime server.
export async function POST(req) {
  const [body, bad] = await parseBody(req, { max: 4 * 1024 })
  if (bad) return bad
  if (!isCode(body.code)) return fail(400, 'invalid code')
  if (!isUid(body.uid)) return fail(400, 'invalid uid')
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  if (!verifyTok(body.code, body.uid, body.tok)) return fail(403, 'not in room')

  const redis = getRedis()
  const r = await relayEphemeral({ code: body.code, uid: body.uid, cid: body.cid, msg: body.msg }, { store: getStore(), redis, rate: 'shared' })
  if (r.error) return r.retryAfter ? tooMany(r.retryAfter, r.error) : fail(r.status, r.error)
  if (r.live === false) return json({ ok: true, live: false })
  await publish(body.code, r.envelope, redis)
  return json({ ok: true })
}
