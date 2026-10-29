// Tells the server, in one short line, that something saved was put back (see app/api/diag). Best effort, a few a minute at most,
// and never anything a person wrote.
let sent = []
export function reportDiag(k, facts = {}) {
  const now = Date.now()
  sent = sent.filter((t) => now - t < 60_000)
  if (sent.length >= 5 || typeof fetch !== 'function') return
  sent.push(now)
  try { fetch('/api/diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, ...facts }), keepalive: true }).catch(() => {}) } catch { /* diagnostics must never break the board */ }
}
