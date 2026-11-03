import { requireOwner, boardRoute } from '../../../../../lib/access.js'
import { json, parseBody, tooMany } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'
import { generateHighlights } from '../../../../../lib/highlightSuggest.js'

export const runtime = 'nodejs'
export const maxDuration = 60 // the provider call may take two 15-second tries, twice

// Asks the model which notes are worth highlighting. Owner only. Nothing is stored: the suggestions are only in this answer.
export const POST = boardRoute(async (req, { code, board }) => {
  await requireOwner(req, board)
  const [, bad] = await parseBody(req)
  if (bad) return bad
  const r = await generateHighlights(code)
  if (r.ok) return noStore(json({ suggestions: r.suggestions }))
  if (r.status === 429) return noStore(tooMany(r.retryAfter, r.error))
  return noStore(Response.json({ error: r.error, ...(r.code && { code: r.code }) }, { status: r.status }))
}, { mutating: true })
