import { getRedis, upstashConfig } from '../../../../lib/db.js'
import { chan, verifyTok } from '../../../../lib/rt.js'
import { getStore } from '../../../../lib/store.js'
import { authorize, HttpError } from '../../../../lib/access.js'
import { isCode, isUid } from '../../../../lib/ids.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_MAX_MS = 270_000 // under Vercel's 300 s, so the client reconnects cleanly instead of being cut off

// How long one connection may live: RT_STREAM_MAX_MS (default 270 s), and never past the membership token's own
// expiry. maxDuration below only applies on Vercel; this deadline works everywhere. The client reconnects, and every
// connect is authorized again, so a revoke or passcode change bites within this window.
function deadlineMs(tok) {
  const configured = Number(process.env.RT_STREAM_MAX_MS)
  const max = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MS
  const exp = Number(String(tok).split('.')[0])
  return Math.max(0, Math.min(max, exp - Date.now()))
}

// Server-Sent Events bridge: Upstash pub/sub (SUBSCRIBE over REST) -> browser. The client auto-reconnects.
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const uid = searchParams.get('uid')
  if (!getRedis()) return new Response('realtime not configured', { status: 503 })
  if (!isCode(code) || !isUid(uid) || !verifyTok(code, uid, searchParams.get('tok'))) return new Response('not in room', { status: 403 })

  // The token is only a membership ticket; board access (revoked, passcode) is re-checked here with the cookies the
  // browser sends to its own origin, so a former guest cannot reconnect with an old token.
  // (Not metered like the board routes: a valid token cannot be forged for a code the caller has not joined.)
  const board = await getStore().getBoard(code)
  if (!board) return new Response('Board not found', { status: 404 })
  try {
    await authorize(req, board)
  } catch (e) {
    if (e instanceof HttpError) return new Response(e.message, { status: e.status })
    throw e
  }

  const ac = new AbortController()
  req.signal.addEventListener('abort', () => ac.abort())
  const deadline = setTimeout(() => ac.abort(), deadlineMs(searchParams.get('tok')))
  let upstream
  try {
    const up = upstashConfig()
    upstream = await fetch(`${up?.url}/subscribe/${encodeURIComponent(chan(code))}`, {
      headers: { Authorization: `Bearer ${up?.token}`, Accept: 'text/event-stream' },
      signal: ac.signal,
      cache: 'no-store',
    })
  } catch {
    clearTimeout(deadline)
    return new Response('upstream failed', { status: 502 })
  }
  if (!upstream.ok || !upstream.body) { clearTimeout(deadline); return new Response('upstream error', { status: 502 }) }

  const enc = new TextEncoder()
  const dec = new TextDecoder()
  let hb
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode('retry: 1500\n\n'))
      hb = setInterval(() => { try { controller.enqueue(enc.encode(': hb\n\n')) } catch { /* closed */ } }, 12000)
      const reader = upstream.body.getReader()
      let buf = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i)
            buf = buf.slice(i + 2)
            if (!frame.startsWith('data: ')) continue
            // Upstash frames look like "message,<channel>,<payload>"; the "subscribe" acks are skipped.
            const p = frame.slice(6)
            const a = p.indexOf(',')
            const b = p.indexOf(',', a + 1)
            if (a < 0 || b < 0 || p.slice(0, a) !== 'message') continue
            controller.enqueue(enc.encode(`data: ${p.slice(b + 1)}\n\n`))
          }
        }
      } catch { /* aborted */ }
      clearInterval(hb)
      clearTimeout(deadline)
      try { controller.close() } catch { /* closed */ }
    },
    cancel() { clearInterval(hb); clearTimeout(deadline); ac.abort() },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
