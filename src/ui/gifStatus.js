// Pure helpers for the GIF results grid: what a failed search means to the person, and a gate that keeps a slow answer to an
// old search from speaking for the current one.

// 'busy' (Giphy's rate limit or quota), 'offline' (no network), or 'unavailable' (any other refusal or failure).
export function classifyGifError(err, { online = true } = {}) {
  if (!online) return 'offline'
  const status = Number(err?.status)
  const text = String(err?.message ?? '')
  if (status === 429 || /rate limit|too many requests|quota/i.test(text)) return 'busy'
  if (status > 0) return 'unavailable'
  return 'offline' // the browser could not reach Giphy at all (fetch rejected without an HTTP answer)
}

export function gifErrorMessage(kind) {
  if (kind === 'busy') return 'Giphy is busy right now. Try again in a minute, or paste a GIF link below.'
  if (kind === 'offline') return 'Could not reach Giphy. Check your connection, or paste a GIF link below.'
  return 'Giphy is not answering right now. Try again, or paste a GIF link below.'
}

// next() starts a new generation; only the newest one is current, and nothing is current once closed (unmounted).
export function createGate() {
  let gen = 0
  let closed = false
  return {
    next: () => ++gen,
    isCurrent: (g) => !closed && g === gen,
    close: () => { closed = true },
  }
}
