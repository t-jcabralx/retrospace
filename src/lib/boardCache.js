// Server-only: a short in-process cache of board documents for the high-rate /api/rt/send path, which must check board
// state (revoked, closed, locked, owner) without reading the board for every ephemeral message. Same idea as the
// persona cache in participants.js. The PATCH and DELETE routes drop the entry in the process that served them, so
// that process sees a change at once; other processes catch up within the TTL. Misses are never cached.
const TTL_MS = 5000
const MAX_ENTRIES = 1000
const cache = (globalThis._rsBoardCache ??= new Map())

export function forgetBoard(code) {
  cache.delete(code)
}

export async function cachedBoard(store, code, now = Date.now()) {
  const hit = cache.get(code)
  if (hit && hit.exp > now) return hit.value
  const value = await store.getBoard(code)
  if (!value) { cache.delete(code); return null }
  cache.delete(code)
  cache.set(code, { value, exp: now + TTL_MS })
  if (cache.size > MAX_ENTRIES) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= MAX_ENTRIES) break }
  return value
}
