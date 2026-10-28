// The owner's removal call. Never throws: -> { ok: true, data } or { ok: false, status, error } with `error` fit to show.
// `fetchImpl` is injectable for tests.
export function removeError(status, serverMessage) {
  if (status === 0) return 'Could not reach the server. Check your connection and try again.'
  if (status === 401) return 'Your session has ended. Sign in again to remove people.'
  if (status === 403) return 'Only the board owner can remove people.'
  if (status === 404) return 'That person is no longer on the board.'
  if (status === 429) return 'Too many requests. Wait a moment and try again.'
  if (status === 409 && typeof serverMessage === 'string' && serverMessage) return serverMessage
  if (status === 400 && typeof serverMessage === 'string' && serverMessage) return serverMessage
  return `Something went wrong (${status}). Please try again.`
}

export async function removeParticipantRequest(code, id, { deleteItems = false } = {}, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/api/boards/${encodeURIComponent(code)}/participants/${encodeURIComponent(id)}?items=${deleteItems ? 1 : 0}`, { method: 'DELETE', cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: removeError(res.status, data?.error) }
  } catch {
    return { ok: false, status: 0, error: removeError(0) }
  }
}

// The owner's current participants: -> { ok: true, participants } or { ok: false, status }. Never throws.
export async function listParticipantsRequest(code, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/api/boards/${encodeURIComponent(code)}/participants`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    return res.ok && Array.isArray(data.participants) ? { ok: true, participants: data.participants } : { ok: false, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}
