import { requireOwner, boardRoute } from '../../../../../../lib/access.js'
import { json, fail, parseBody } from '../../../../../../lib/http.js'
import { noStore } from '../../../../../../lib/auth.js'
import { isCid } from '../../../../../../lib/ids.js'
import { opsEnvelopes } from '../../../../../../lib/anon.js'
import { publish } from '../../../../../../lib/rt.js'
import { publicIdForUser } from '../../../../../../lib/guest.js'

export const runtime = 'nodejs'

// Starts a new vote round: the owner empties the votes on every live item. The changed items go out like any other
// ops (so peers and pollers converge through the usual last-writer-wins merge); settings, and so `rev`, are untouched.
export const POST = boardRoute(async (req, { code, board, store }) => {
  const user = await requireOwner(req, board)
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  const { changed, skipped } = await store.clearVotes(code)
  if (changed.length) for (const env of opsEnvelopes({ t: 'ops', from: publicIdForUser(code, user.id), ...(body.cid && { cid: body.cid }), ops: changed })) await publish(code, env)
  return noStore(json({ cleared: changed.length, skipped })) // `skipped`: items that kept changing under the reset and still hold their votes
}, { mutating: true })
