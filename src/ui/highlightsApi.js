// The owner's "suggest highlights" call. It never throws: -> { ok: true, suggestions } or { ok: false, status, error } with `error` fit to show.
// `fetchImpl` is injectable.
export function highlightsError(status, data) {
  if (status === 0) return 'Could not reach the server. Check your connection and try again.'
  if (status === 401) return 'Your session has ended. Sign in again to use AI.'
  if (status === 404) return 'This board no longer exists.'
  if (typeof data?.error === 'string' && data.error && status < 600) return data.error
  return `Something went wrong (${status}). Please try again.`
}

export async function suggestHighlightsRequest(code, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/api/boards/${encodeURIComponent(code)}/highlights`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: '{}' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, status: res.status, error: highlightsError(res.status, data) }
    return { ok: true, suggestions: Array.isArray(data.suggestions) ? data.suggestions.filter((s) => s && typeof s.id === 'string') : [] }
  } catch {
    return { ok: false, status: 0, error: highlightsError(0) }
  }
}
