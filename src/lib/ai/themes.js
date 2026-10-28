// AI theme grouping, pure parts: the prompt input (short ids only), the strict reading of the model's JSON, and the owner's
// edits of the stored suggestions. Server only (the panel sends edits to the route, which applies them here).
import { categorizeRaw, flat, MAX_ITEMS, MAX_ITEM_CHARS } from './input.js'
import { cleanSummaryText } from '../aiBoard.js'

import { MAX_THEME_TITLE, MAX_THEME_NOTES } from '../validate.js'

export const MAX_THEMES = 12

const clip = (s, n) => { const c = Array.from(s); return c.length > n ? c.slice(0, n).join('') : s }

// Notes only (the things a theme can link to). -> { text, count, ids } where `ids` maps the short id the model sees ("n1") to the
// real item id; real ids, authors and signers never go into the text. Over the cap the least-voted, longest notes are left out.
export function buildThemeInput(items, { boardTitle = '' } = {}) {
  const noteIds = new Set((items ?? []).filter((i) => i.kind === 'note').map((i) => i.id))
  let rows = categorizeRaw(items).filter((r) => noteIds.has(r.id)) // all items are read, so the frames still name the columns
  if (rows.length > MAX_ITEMS) {
    const doomed = new Set([...rows].sort((a, b) => a.votes - b.votes || Array.from(b.text).length - Array.from(a.text).length || a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1)).slice(0, rows.length - MAX_ITEMS).map((r) => r.id))
    rows = rows.filter((r) => !doomed.has(r.id))
  }
  const ids = new Map()
  const lines = []
  const title = flat(boardTitle)
  if (title) lines.push(`Board title: ${title}`)
  let current = null
  rows.forEach((r, n) => {
    const short = `n${n + 1}`
    ids.set(short, r.id)
    if (r.category !== current) { current = r.category; lines.push('', `## ${current}`) }
    lines.push(`[${short}] ${clip(r.text, MAX_ITEM_CHARS)}`)
  })
  return { text: lines.join('\n').trim(), count: rows.length, ids }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function cleanTitle(raw) {
  if (typeof raw !== 'string') return ''
  return clip(cleanSummaryText(raw).replace(/\s+/g, ' ').trim(), MAX_THEME_TITLE).trim()
}

// The model's text -> JSON object or null. Tolerates a ```json fence or a sentence around the object; nothing else.
function extractJson(text) {
  const t = cleanSummaryText(text)
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { const v = JSON.parse(t.slice(a, b + 1)); return isObj(v) ? v : null } catch { return null }
}

// -> null when the reply is not the expected JSON at all (the caller retries once), else [{ title, noteIds: [realId] }]:
// at most 12 themes, titles cleaned to 1-60 characters (a theme without one is dropped), unknown ids dropped, a note in at
// most one theme (the first), at most 50 notes a theme, themes left without notes dropped. Leftover notes stay ungrouped.
export function parseThemes(text, ids) {
  const data = extractJson(text)
  if (!data || !Array.isArray(data.themes)) return null
  const used = new Set()
  const out = []
  for (const t of data.themes) {
    if (out.length >= MAX_THEMES) break
    if (!isObj(t)) continue
    const title = cleanTitle(t.title)
    if (!title || !Array.isArray(t.noteIds)) continue
    const noteIds = []
    for (const s of t.noteIds) {
      if (typeof s !== 'string' || !ids.has(s) || used.has(s) || noteIds.length >= MAX_THEME_NOTES) continue
      used.add(s)
      noteIds.push(ids.get(s))
    }
    if (noteIds.length) out.push({ title, noteIds })
  }
  return out
}

// Stored suggestions: { themes: [{ id, title, noteIds }], generatedAt, model }. Ids are ours ("s1"...), never the model's.
export const withIds = (themes) => themes.map((t, n) => ({ id: `s${n + 1}`, ...t }))

const find = (list, id) => list.find((t) => t.id === id)
const sid = (v) => typeof v === 'string' && /^s\d{1,3}$/.test(v)

// The owner's edits. `edit` = { edit: 'rename', id, title } | { edit: 'combine', ids: [a, b] } | { edit: 'split', id, noteIds }
// | { edit: 'dismiss', id } -> { ok: true, themes } | { ok: false, error }. Pure; the input list is not touched.
export function editSuggestions(list, edit) {
  if (!isObj(edit)) return { ok: false, error: 'invalid edit' }
  const themes = (list ?? []).map((t) => ({ ...t, noteIds: [...t.noteIds] }))
  switch (edit.edit) {
    case 'rename': {
      const t = sid(edit.id) && find(themes, edit.id)
      const title = cleanTitle(edit.title)
      if (!t) return { ok: false, error: 'No such suggestion' }
      if (!title) return { ok: false, error: 'A theme needs a title' }
      t.title = title
      return { ok: true, themes }
    }
    case 'dismiss': {
      if (!sid(edit.id) || !find(themes, edit.id)) return { ok: false, error: 'No such suggestion' }
      return { ok: true, themes: themes.filter((t) => t.id !== edit.id) }
    }
    case 'combine': {
      const [a, b] = Array.isArray(edit.ids) && edit.ids.length === 2 && edit.ids[0] !== edit.ids[1] && edit.ids.every(sid) ? edit.ids.map((i) => find(themes, i)) : []
      if (!a || !b) return { ok: false, error: 'Pick two different suggestions' }
      a.noteIds = [...a.noteIds, ...b.noteIds].slice(0, MAX_THEME_NOTES)
      return { ok: true, themes: themes.filter((t) => t !== b) }
    }
    case 'split': { // the chosen notes leave the suggestion and stay ungrouped; a suggestion left empty goes
      const t = sid(edit.id) && find(themes, edit.id)
      if (!t) return { ok: false, error: 'No such suggestion' }
      if (!Array.isArray(edit.noteIds) || !edit.noteIds.length || edit.noteIds.length > MAX_THEME_NOTES || !edit.noteIds.every((n) => typeof n === 'string')) return { ok: false, error: 'Pick the notes to take out' }
      const out = new Set(edit.noteIds)
      t.noteIds = t.noteIds.filter((n) => !out.has(n))
      return { ok: true, themes: themes.filter((x) => x.noteIds.length) }
    }
    default:
      return { ok: false, error: 'invalid edit' }
  }
}

// The fake provider's grouping: one theme per column, from the prompt text. Deterministic, no network.
export function fakeThemes(text) {
  const themes = []
  let current = null
  for (const line of String(text).split('\n')) {
    const h = /^## (.+)$/.exec(line)
    if (h) { current = { title: h[1].slice(0, MAX_THEME_TITLE), noteIds: [] }; themes.push(current); continue }
    const n = /^\[(n\d+)\]/.exec(line)
    if (n && current) current.noteIds.push(n[1])
  }
  return { themes: themes.filter((t) => t.noteIds.length).slice(0, MAX_THEMES) }
}
