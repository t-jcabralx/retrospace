// The owner's two write calls (settings PATCH, vote reset) and how their failures read to a person. `fetchImpl` is
// injectable for tests. Neither call throws: -> { ok: true, data } or { ok: false, status, error } with `error` fit to show.
export function ownerError(status, serverMessage) {
  if (status === 0) return 'Could not reach the server. Check your connection and try again.'
  if (status === 401) return 'Your session has ended. Sign in again to change settings.'
  if (status === 403) return 'Only the board owner can change settings.'
  if (status === 404) return 'This board no longer exists.'
  if (status === 429) return 'Too many changes in a short time. Wait a moment and try again.'
  if (status === 400 && typeof serverMessage === 'string' && serverMessage) return serverMessage[0].toUpperCase() + serverMessage.slice(1)
  return `Something went wrong (${status}). Please try again.`
}

async function send(method, url, body, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: ownerError(res.status, data?.error) }
  } catch {
    return { ok: false, status: 0, error: ownerError(0) }
  }
}

// `cid` names this tab so its own echo is skipped; it is left out when unknown (an invalid one is a 400, never send null).
const withCid = (cid, rest) => ({ ...rest, ...(typeof cid === 'string' && cid ? { cid } : {}) })

export const patchBoardRequest = (code, patch, cid, fetchImpl = globalThis.fetch) => send('PATCH', `/api/boards/${code}`, withCid(cid, { patch }), fetchImpl)
export const resetVotesRequest = (code, cid, fetchImpl = globalThis.fetch) => send('POST', `/api/boards/${code}/votes/reset`, withCid(cid, {}), fetchImpl)
