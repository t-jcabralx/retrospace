// Tells a person when the server fails, without a monitoring service: a short message posted to a webhook (Slack, Teams and
// Discord all accept it). Server only. Never sends a request body, header, cookie or stack, only the method, the path, a
// trimmed message and a count; the same problem is reported at most once every ten minutes and never more than twenty
// times an hour, so a broken deploy cannot flood a channel.
const SAME_MS = 10 * 60_000
const HOUR_MS = 60 * 60_000
const MAX_PER_HOUR = 20

// Digits, long ids and anything that looks like a secret or an address are blurred, so the message says what broke, not who.
export function describe(err, req) {
  const raw = String(err?.message ?? err ?? 'error').replace(/\s+/g, ' ')
  const message = raw.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '…').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '…').replace(/\d{4,}/g, '#').slice(0, 160)
  const path = String(req?.path ?? '').replace(/\?.*$/, '').replace(/\/[A-Z0-9]{6}(?=\/|$)/g, '/:code').slice(0, 80)
  return { method: String(req?.method ?? ''), path, message }
}

export function createAlerter({ url, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const seen = new Map()
  let hour = { start: 0, n: 0 }
  return async function alert(err, req) {
    if (!url) return false
    const d = describe(err, req)
    const key = `${d.method} ${d.path} ${d.message}`
    const t = now()
    if (t - (seen.get(key) ?? -Infinity) < SAME_MS) return false
    if (t - hour.start > HOUR_MS) hour = { start: t, n: 0 }
    if (hour.n >= MAX_PER_HOUR) return false
    hour.n++
    seen.set(key, t)
    if (seen.size > 200) seen.delete(seen.keys().next().value)
    const text = `Retrospace error: ${d.method} ${d.path}: ${d.message}`
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(4000) })
      return res.ok
    } catch { return false }
  }
}
