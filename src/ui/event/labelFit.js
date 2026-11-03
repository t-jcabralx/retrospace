// Fitting a label into a slice of the wheel when it is written ALONG the slice (from the middle of the wheel outwards): the room is
// the ring's thickness in one direction and the slice's width in the other. Pure. The text gets as large as it can be, wrapped onto
// up to three lines; only when even the smallest size cannot hold it all is it cut, with an ellipsis, on its last line.
export const GLYPH = 0.56 // an average letter is this many ems wide
export const LINE = 1.15 // line height, in ems

const chars = (s) => Array.from(s)
const cut = (line, n) => (chars(line).length > n ? `${chars(line).slice(0, Math.max(1, n - 1)).join('')}…` : line)

// Greedy wrap on spaces. A word longer than a line stays whole (the caller cuts it).
export function wrapWords(text, perLine) {
  const n = Math.max(1, perLine)
  const lines = []
  let cur = ''
  for (const w of String(text).split(' ').filter(Boolean)) {
    if (!cur) cur = w
    else if (chars(cur).length + 1 + chars(w).length <= n) cur += ` ${w}`
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines
}

// -> { lines: [string], size, cut: boolean }. `length`: room along the slice, `width`: room across it, both in pixels.
export function fitLabel(text, { length, width, max, min = 9, maxLines = 3 }) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return { lines: [], size: min, cut: false }
  for (let size = max; size >= min; size -= 0.5) {
    const perLine = Math.floor(length / (GLYPH * size))
    const lines = wrapWords(t, perLine)
    if (lines.length <= maxLines && lines.length * size * LINE <= width && lines.every((l) => chars(l).length <= perLine)) return { lines, size, cut: false }
  }
  const size = min
  const perLine = Math.max(2, Math.floor(length / (GLYPH * size)))
  const room = Math.max(1, Math.min(maxLines, Math.floor(width / (size * LINE))))
  const all = wrapWords(t, perLine)
  const lines = all.slice(0, room).map((l) => cut(l, perLine))
  const more = all.length > room
  if (more) {
    const last = lines[lines.length - 1].replace(/…$/, '')
    lines[lines.length - 1] = chars(last).length >= perLine ? `${chars(last).slice(0, perLine - 1).join('')}…` : `${last}…`
  }
  return { lines, size, cut: more || all.some((l) => chars(l).length > perLine) }
}
