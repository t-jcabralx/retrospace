import { authorize, boardRoute, viewerBoard } from '../../../../../lib/access.js'
import { viewerItems } from '../../../../../lib/anon.js'
import { boardId } from '../../../../../lib/guest.js'
import { isRevealed } from '../../../../../lib/reveal.js'
import { json, fail } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'

export const runtime = 'nodejs'

// What the recipient's reveal page reads, read-only: no guest identity is minted and nothing is written. The board
// (guest-safe, or the owner's own view) always comes back; the cards only once the reveal time has passed, or to the owner
// (who previews). Before that the answer says `sealed: true` and carries no `items` at all, so a countdown page never
// holds a card. `t` (optional) asks for changes since that updatedAt, like /since; without it, every card. The code is the
// board's only secret, so anyone holding it can still open /b/[code]: this keeps the reveal page itself honest.
export const GET = boardRoute(async (req, { code, board, store }) => {
  const viewer = await authorize(req, board)
  const raw = new URL(req.url).searchParams.get('t')
  const t = raw === null ? null : raw.trim() === '' ? NaN : Number(raw)
  if (t !== null && !Number.isFinite(t)) return fail(400, 'invalid t')
  const now = Date.now()
  const out = { board: viewerBoard(board, viewer.role), role: viewer.role, now }
  if (!isRevealed(board, now, viewer.role)) {
    // updatedAt and lastTs advance with every card added, which would let a countdown page watch the activity: left out.
    // The same goes for the summary: a shared recap of a celebration discloses its cards, and "generating" shows the owner at work.
    const { updatedAt, lastTs, ...calm } = out.board // eslint-disable-line no-unused-vars
    return noStore(json({ ...out, board: { ...calm, summary: null, summaryState: 'idle' }, sealed: true }))
  }
  const items = t === null ? await store.listItems(code) : await store.itemsSince(code, t)
  return noStore(json({ ...out, sealed: false, items: viewerItems(items.filter((i) => i.kind === 'card'), { viewerId: boardId(req, code, viewer), role: viewer.role }) }))
})
