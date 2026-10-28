import { requireOwner, boardRoute, viewerBoard } from '../../../../../lib/access.js'
import { json, fail, parseBody, tooMany } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'
import { isCid } from '../../../../../lib/ids.js'
import { generateSummary } from '../../../../../lib/summary.js'

export const runtime = 'nodejs'
export const maxDuration = 60 // the provider call may take two 15-second tries

// What the owner's panel polls while a summary is being written: the owner's view of the summary and its state, which may
// be a draft or a failure and so is never part of any other response.
export const GET = boardRoute(async (req, { board }) => {
  await requireOwner(req, board)
  const { summary, summaryState, summaryError } = viewerBoard(board, 'owner')
  return noStore(json({ summary, summaryState, ...(summaryError && { summaryError }) }))
})

// Writes a summary now (always a draft: only an automatic one honours autoShare). The provider is called without holding
// anything; "generating" on the board stops a second request.
export const POST = boardRoute(async (req, { code, board }) => {
  await requireOwner(req, board)
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  const r = await generateSummary(code, { cid: body.cid })
  if (r.ok) return noStore(json({ summary: r.summary, summaryState: 'idle' }))
  if (r.status === 429) return noStore(tooMany(r.retryAfter, r.error))
  return noStore(Response.json({ error: r.error, ...(r.code && { code: r.code }) }, { status: r.status }))
}, { mutating: true })
