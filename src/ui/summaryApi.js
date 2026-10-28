// The owner's two summary calls and the words for what can go wrong. Neither call throws: -> { ok: true, data } or
// { ok: false, status, error } with `error` fit to show. `fetchImpl` is injectable for tests.
import { aiMessage } from '../lib/aiBoard.js'

export function summaryError(status, data) {
  if (status === 0) return 'Could not reach the server. Check your connection and try again.'
  if (status === 401) return 'Your session has ended. Sign in again to use summaries.'
  if (status === 403) return typeof data?.error === 'string' && data.error ? data.error : 'Only the board owner can write a summary.'
  if (status === 404) return 'This board no longer exists.'
  if (status === 409 || status === 503 || status === 504 || status === 502) {
    if (data?.code) return aiMessage(data.code)
    if (typeof data?.error === 'string' && data.error) return data.error
  }
  if (status === 429) return typeof data?.error === 'string' && data.error ? data.error : 'Too many summaries. Try again later.'
  return `Something went wrong (${status}). Please try again.`
}

async function send(method, url, body, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: summaryError(res.status, data) }
  } catch {
    return { ok: false, status: 0, error: summaryError(0) }
  }
}

const withCid = (cid) => (typeof cid === 'string' && cid ? { cid } : {})

export const getSummaryRequest = (code, fetchImpl = globalThis.fetch) => send('GET', `/api/boards/${code}/summary`, null, fetchImpl)
export const generateSummaryRequest = (code, cid, fetchImpl = globalThis.fetch) => send('POST', `/api/boards/${code}/summary`, withCid(cid), fetchImpl)

// Who gets the Summary button: the owner always on a retro board, and elsewhere once AI is on or a summary exists;
// everyone else only while a summary is shared with them.
export function showSummaryButton(board, isOwner) {
  if (!board) return false
  if (!isOwner) return Boolean(board.summary)
  return board.type === 'retro' || Boolean(board.ai?.enabled) || Boolean(board.summary)
}

// How a shared or draft summary is labelled; the owner's edit mark is shown the same way to everyone.
export const sourceLabel = (s) => (s?.source === 'ai' ? (s.editedAt ? 'AI-generated, edited by the owner' : 'AI-generated') : 'Written by the owner')
