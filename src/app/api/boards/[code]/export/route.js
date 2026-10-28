import { requireOwner, boardRoute } from '../../../../../lib/access.js'
import { fail, rateLimited, windowHit, tooMany, retryAfterSecs } from '../../../../../lib/http.js'
import { boardCsv } from '../../../../../lib/csv.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WINDOW_MS = 60_000
const PER_MIN = 10

// "<title>-<YYYY-MM-DD>" made safe for a Content-Disposition filename: letters, digits, dash and underscore only.
export function exportName(title, date = new Date()) {
  const base = String(title ?? '').normalize('NFKD').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'board'
  return `${base}-${date.toISOString().slice(0, 10)}`
}

// Owner-only CSV of the board: GET ?format=csv[&authors=1]. One read of board, items and participants. Author names
// (the anonymous names people chose) are included only on request. Never cached; counted per owner, 10 a minute.
export const GET = boardRoute(async (req, { code, board, store }) => {
  const user = await requireOwner(req, board)
  const q = new URL(req.url).searchParams
  if (q.get('format') !== 'csv') return fail(400, 'format must be csv')
  const authors = q.get('authors')
  if (authors !== null && authors !== '0' && authors !== '1') return fail(400, 'authors must be 0 or 1')
  if ((await windowHit(`export:${user.id}`, WINDOW_MS, { localFallback: true })) > PER_MIN) return tooMany(retryAfterSecs(WINDOW_MS))
  const [fresh, items, participants] = await Promise.all([store.getBoard(code), store.listItems(code), store.listParticipants(code)])
  if (!fresh) return fail(404, 'Board not found')
  const body = boardCsv(fresh, items, participants, { authors: authors === '1' })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportName(fresh.title)}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
