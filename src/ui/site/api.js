// Tiny fetch helpers for the account, join and dashboard screens. They never throw: a request that gets no answer
// resolves with status 0. -> { ok, status, data, retryAfter }
import { retryAfterSeconds } from '../../lib/code.js'

async function request(url, init) {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data, retryAfter: retryAfterSeconds(res.headers.get('Retry-After')) }
  } catch {
    return { ok: false, status: 0, data: {}, retryAfter: null }
  }
}

export const getJson = (url) => request(url)

export const postJson = (url, body = {}) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
