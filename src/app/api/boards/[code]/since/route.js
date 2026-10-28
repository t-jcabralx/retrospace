import { authorize, boardRoute, viewerBoard } from '../../../../../lib/access.js'
import { viewerItems } from '../../../../../lib/anon.js'
import { boardId } from '../../../../../lib/guest.js'
import { json, fail } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'

export const runtime = 'nodejs'

export const GET = boardRoute(async (req, { code, board, store }) => {
  const viewer = await authorize(req, board)
  const raw = new URL(req.url).searchParams.get('t')
  const t = raw === null || raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(t)) return fail(400, 'invalid t')
  // `board` (guest-safe, whoever asks) lets polling clients pick up settings changes the stream would have pushed.
  return noStore(json({ items: viewerItems(await store.itemsSince(code, t), { viewerId: boardId(req, code, viewer), role: viewer.role }), board: viewerBoard(board, 'guest'), now: Date.now() }))
})
