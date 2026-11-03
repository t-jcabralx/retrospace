// AI highlights, pure parts: the prompt input, the strict reading of the model's JSON, and a canned answer for development. Server
// only. The model only SUGGESTS which notes to highlight; the owner decides, and nothing is stored until a highlight is accepted.
import { buildThemeInput, extractJson } from './themes.js'
import { cleanSummaryText } from '../aiBoard.js'

export const MAX_AI_HIGHLIGHTS = 8
export const MAX_REASON = 140

// The same input as theme grouping: notes only, as "[n3] text" under their column, with short ids and no authors, uids or avatars.
export const buildHighlightInput = buildThemeInput

const clip = (s, n) => { const c = Array.from(s); return c.length > n ? c.slice(0, n - 1).join('') + '…' : s }

export function cleanReason(raw) {
  if (typeof raw !== 'string') return ''
  return clip(cleanSummaryText(raw).replace(/\s+/g, ' ').trim(), MAX_REASON)
}

// -> null when the reply is not the expected JSON at all (the caller retries once), else [{ id: realId, reason }]: at most 8,
// unknown ids dropped, a note once, a missing reason becomes an empty string (the note is still worth showing).
export function parseHighlights(text, ids) {
  const data = extractJson(text)
  if (!data || !Array.isArray(data.highlights)) return null
  const seen = new Set()
  const out = []
  for (const h of data.highlights) {
    if (out.length >= MAX_AI_HIGHLIGHTS) break
    if (h === null || typeof h !== 'object' || Array.isArray(h)) continue
    const short = h.noteId
    if (typeof short !== 'string' || !ids.has(short) || seen.has(short)) continue
    seen.add(short)
    out.push({ id: ids.get(short), reason: cleanReason(h.reason) })
  }
  return out
}

// Deterministic, for AI_FAKE=1: the first note of each column, as the JSON the real model is asked for.
export function fakeHighlights(text) {
  const picks = []
  let seenHeading = false
  let taken = false
  for (const line of String(text).split('\n')) {
    if (/^## /.test(line)) { seenHeading = true; taken = false; continue }
    const n = /^\[(n\d+)\]/.exec(line)
    if (n && !taken && (seenHeading || !picks.length)) { picks.push({ noteId: n[1], reason: 'Sample reason from the development fake, not written by an AI.' }); taken = true }
  }
  return { highlights: picks.slice(0, MAX_AI_HIGHLIGHTS) }
}
