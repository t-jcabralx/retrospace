// The owner's theme-suggestion calls plus the pure helpers the Themes panel and the theme card share.
// Neither call throws: -> { ok: true, data } or { ok: false, status, error } with `error` fit to show. `fetchImpl` is injectable.
import { addOp, nextZ } from './ops.js'

export function themesError(status, data) {
  if (status === 0) return 'Could not reach the server. Check your connection and try again.'
  if (status === 401) return 'Your session has ended. Sign in again to group notes.'
  if (typeof data?.error === 'string' && data.error && status < 600 && status !== 404) return data.error
  if (status === 404) return 'This board no longer exists.'
  return `Something went wrong (${status}). Please try again.`
}

async function send(method, code, body, fetchImpl) {
  try {
    const res = await fetchImpl(`/api/boards/${encodeURIComponent(code)}/themes`, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: themesError(res.status, data) }
  } catch {
    return { ok: false, status: 0, error: themesError(0) }
  }
}

export const getThemesRequest = (code, fetchImpl = globalThis.fetch) => send('GET', code, null, fetchImpl)
export const suggestThemesRequest = (code, fetchImpl = globalThis.fetch) => send('POST', code, {}, fetchImpl)
export const editThemesRequest = (code, edit, fetchImpl = globalThis.fetch) => send('PATCH', code, edit, fetchImpl)

export const THEME_W = 260
export const THEME_H = 150
const GAP = 24

// Where the next theme card goes: in a row under everything on the board, left-aligned with the leftmost item.
export function themeSlot(items, n = 0) {
  const live = (items ?? []).filter((i) => i && !i.deleted)
  const left = live.length ? Math.min(...live.map((i) => i.x)) : 0
  const bottom = live.length ? Math.max(...live.map((i) => i.y + i.h)) : 0
  const perRow = 4
  return { x: left + (n % perRow) * (THEME_W + GAP), y: bottom + 80 + Math.floor(n / perRow) * (THEME_H + GAP) }
}

// The ordinary add op for an accepted suggestion (or a hand-made theme): { title, noteIds } -> an `add` op. Notes that are gone
// are left out of the links; the theme is a normal item from here on.
export function acceptOp(items, suggestion, id) {
  const live = new Set((items ?? []).filter((i) => i.kind === 'note' && !i.deleted).map((i) => i.id))
  const noteIds = (suggestion.noteIds ?? []).filter((n) => live.has(n)).slice(0, 50)
  const n = (items ?? []).filter((i) => i.kind === 'theme' && !i.deleted).length
  const slot = themeSlot(items, n)
  return addOp('theme', { x: slot.x, y: slot.y, w: THEME_W, h: THEME_H }, { title: String(suggestion.title ?? '').slice(0, 60) || 'Theme', noteIds }, nextZ(items ?? [], 'theme'), id)
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
export const noteExcerpt = (item, n = 70) => clip(item?.data?.text, n) || '(empty note)'

// The live notes a theme links to, in link order; links to deleted or missing items are skipped.
export function linkedNotes(theme, byId) {
  const out = []
  for (const id of theme?.data?.noteIds ?? []) {
    const n = byId?.get ? byId.get(id) : byId?.[id]
    if (n && n.kind === 'note' && !n.deleted) out.push(n)
  }
  return out
}
