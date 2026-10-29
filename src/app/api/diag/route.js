import { json, fail, parseBody, rateLimited } from '../../../lib/http.js'

export const runtime = 'nodejs'

// A browser telling us, in one short line, that something it had saved was put back (a write refused, a temporary position that
// expired). Nothing a person wrote is ever sent: only the kind, the server's own refusal text, and a few small facts. It goes to
// the server log and nowhere else, so the cause of a "it went back" report can be read from the Vercel logs.
const KINDS = ['rejected', 'drag-expired']
const FIELDS = { error: 80, board: 12, role: 12, stage: 16, status: 12, op: 12, kind: 12 }

export async function POST(req) {
  if (await rateLimited(req, 'diag', 30)) return fail(429, 'slow down')
  const [body, bad] = await parseBody(req, { max: 2 * 1024 })
  if (bad) return bad
  if (!KINDS.includes(body.k)) return fail(400, 'unknown kind')
  const line = { k: body.k }
  for (const [name, max] of Object.entries(FIELDS)) if (typeof body[name] === 'string') line[name] = body[name].replace(/[^\w .,:;'()/-]/g, '').slice(0, max)
  if (Number.isInteger(body.n) && body.n >= 0 && body.n < 1000) line.n = body.n
  console.error(`retrospace-diag ${JSON.stringify(line)}`)
  return json({ ok: true })
}
