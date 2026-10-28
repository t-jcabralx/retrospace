import { requireOwner, boardRoute } from '../../../../../lib/access.js'
import { json, parseBody, fail, tooMany } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'
import { generateThemes, editThemes, themesView } from '../../../../../lib/themeSuggest.js'

export const runtime = 'nodejs'
export const maxDuration = 60 // the provider call may take two 15-second tries, twice

const reply = (r) => {
  if (r.ok) return noStore(json({ suggestions: r.suggestions, themesState: 'idle' }))
  if (r.status === 429) return noStore(tooMany(r.retryAfter, r.error))
  return noStore(Response.json({ error: r.error, ...(r.code && { code: r.code }) }, { status: r.status }))
}

// The owner's theme suggestions. They are in no board view: this route is the only way to read them.
export const GET = boardRoute(async (req, { board }) => {
  await requireOwner(req, board)
  return noStore(json(themesView(board)))
})

// Asks the model for themes now. The suggestions are stored apart from the board and never touch a note.
export const POST = boardRoute(async (req, { code, board }) => {
  await requireOwner(req, board)
  const [, bad] = await parseBody(req)
  if (bad) return bad
  return reply(await generateThemes(code))
}, { mutating: true })

// Edits the stored suggestions: { edit: 'rename' | 'combine' | 'split' | 'dismiss', ... } (see ai/themes.js).
export const PATCH = boardRoute(async (req, { code, board }) => {
  await requireOwner(req, board)
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  if (!body.edit || typeof body.edit !== 'string') return fail(400, 'invalid edit')
  return reply(await editThemes(code, body))
}, { mutating: true })
