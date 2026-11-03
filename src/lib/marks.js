// Highlighted words inside a note: data.marks = [{ s, e, c }], a colour over the characters s..e of data.text (counted in whole
// characters, not UTF-16 units, so an emoji is one). Pure; shared by the server rules (validate.js) and the note editor.
export const MARK_COLORS = ['yellow', 'green', 'pink', 'blue']
export const MAX_MARKS = 20

const chars = (s) => Array.from(String(s ?? ''))
export const charLength = (s) => chars(s).length
// An index into the string as the textarea counts it (UTF-16 units) -> as a mark counts it (characters).
export const toCharIndex = (text, i) => chars(String(text ?? '').slice(0, i)).length

// Anything wrong in `marks` is dropped, never refused: a note whose text another client changed keeps whatever still fits.
// Sorted, clipped to the text, overlaps trimmed, touching marks of one colour joined, at most MAX_MARKS.
export function normalizeMarksLen(len, marks) {
  if (!Array.isArray(marks)) return []
  const sane = []
  for (const m of marks) {
    if (m === null || typeof m !== 'object') continue
    const { s, e, c } = m
    if (!Number.isInteger(s) || !Number.isInteger(e) || !MARK_COLORS.includes(c)) continue
    const a = Math.max(0, s)
    const b = Math.min(len, e)
    if (b > a) sane.push({ s: a, e: b, c })
  }
  sane.sort((x, y) => x.s - y.s || x.e - y.e)
  const out = []
  for (const m of sane) {
    const last = out[out.length - 1]
    const s = last ? Math.max(m.s, last.e) : m.s
    if (m.e <= s) continue
    if (last && last.e === s && last.c === m.c) last.e = m.e
    else out.push({ s, e: m.e, c: m.c })
  }
  return out.slice(0, MAX_MARKS)
}
export const normalizeMarks = (text, marks) => normalizeMarksLen(charLength(text), marks)

// Keeps the marks on the same words when the text is edited: the changed stretch is found from what the old and new text share at
// their start and end. Marks before it stay, marks after it move by the length change, marks it cuts keep their outside parts, and
// typing inside a marked word makes the word longer.
export function rebaseMarks(oldText, newText, marks) {
  if (!Array.isArray(marks) || !marks.length) return []
  const a = chars(oldText)
  const b = chars(newText)
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let q = 0
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  const oldEnd = a.length - q
  const delta = b.length - a.length
  const out = []
  for (const m of normalizeMarksLen(a.length, marks)) {
    if (m.e <= p) out.push(m)
    else if (m.s >= oldEnd) out.push({ s: m.s + delta, e: m.e + delta, c: m.c })
    else if (oldEnd === p && m.s < p && p < m.e) out.push({ s: m.s, e: m.e + delta, c: m.c }) // an insertion inside a marked word
    else {
      if (m.s < p) out.push({ s: m.s, e: p, c: m.c })
      if (m.e > oldEnd) out.push({ s: oldEnd + delta, e: m.e + delta, c: m.c })
    }
  }
  return normalizeMarksLen(b.length, out)
}

const covered = (marks, a, b, color) => {
  let at = a
  for (const m of marks) {
    if (m.c !== color || m.e <= at) continue
    if (m.s > at) return false
    at = m.e
    if (at >= b) return true
  }
  return at >= b
}

// Puts `color` on the characters a..b (code point indices), or takes marks off them when `color` is null or the whole stretch
// already has that colour. -> the new marks.
export function applyMark(marks, from, to, color, len) {
  const a = Math.max(0, Math.min(from, to))
  const b = Math.min(len, Math.max(from, to))
  const cur = normalizeMarksLen(len, marks)
  if (b <= a) return cur
  const off = color === null || covered(cur, a, b, color)
  const rest = []
  for (const m of cur) {
    if (m.e <= a || m.s >= b) { rest.push(m); continue }
    if (m.s < a) rest.push({ s: m.s, e: a, c: m.c })
    if (m.e > b) rest.push({ s: b, e: m.e, c: m.c })
  }
  if (!off) rest.push({ s: a, e: b, c: color })
  return normalizeMarksLen(len, rest)
}

// The text as pieces to draw: [{ text, color }], color null for plain text.
export function segments(text, marks) {
  const cs = chars(text)
  const out = []
  let at = 0
  for (const m of normalizeMarksLen(cs.length, marks)) {
    if (m.s > at) out.push({ text: cs.slice(at, m.s).join(''), color: null })
    out.push({ text: cs.slice(m.s, m.e).join(''), color: m.c })
    at = m.e
  }
  if (at < cs.length) out.push({ text: cs.slice(at).join(''), color: null })
  return out
}
