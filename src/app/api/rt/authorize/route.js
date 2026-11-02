import { getStore } from '../../../../lib/store.js'
import { cachedBoard } from '../../../../lib/boardCache.js'
import { cachedParticipant } from '../../../../lib/participants.js'
import { isCode, isUid } from '../../../../lib/ids.js'
import { json, fail, parseBody } from '../../../../lib/http.js'
import { verifyAuthorize, realtimeFacts } from '../../../../lib/rtAuthorize.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Only the realtime server calls this (see lib/rtAuthorize.js): the request must be signed with RT_SECRET. Answers with the facts about one
// person on one board; nothing is written. Anybody else gets the same 403, so the endpoint reveals nothing about which boards exist.
export async function POST(req) {
  const [body, bad] = await parseBody(req, { max: 1024 })
  if (bad) return bad
  const { code, uid } = body
  if (!isCode(code) || !isUid(uid)) return fail(403, 'forbidden')
  if (!verifyAuthorize({ ts: req.headers.get('x-rt-ts'), sig: req.headers.get('x-rt-sig'), code, uid })) return fail(403, 'forbidden')
  const store = getStore()
  const board = await cachedBoard(store, code)
  if (!board) return fail(404, 'Board not found')
  const persona = await cachedParticipant(store, code, uid)
  return json(realtimeFacts({ board, persona, code, uid }))
}
