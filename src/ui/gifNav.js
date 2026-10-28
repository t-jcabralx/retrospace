// Arrow-key movement through a masonry grid of tiles. Pure: tiles are rectangles { left, top, width, height } (as from
// getBoundingClientRect), so the layout need not be a regular grid. -> the index of the tile to focus next.
const cx = (r) => r.left + r.width / 2
const cy = (r) => r.top + r.height / 2
const overlapX = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width
const overlapY = (a, b) => a.top < b.top + b.height && b.top < a.top + a.height

// Indexes sorted top to bottom, then left to right.
export const readingOrder = (rects) =>
  rects.map((r, i) => i).sort((a, b) => rects[a].top - rects[b].top || rects[a].left - rects[b].left || a - b)

export function nextTile(rects, from, key) {
  if (!rects.length) return -1
  const order = readingOrder(rects)
  if (key === 'Home') return order[0]
  if (key === 'End') return order.at(-1)
  const cur = rects[from]
  if (!cur) return key.startsWith('Arrow') ? order[0] : from
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key]
  if (!dir) return from
  const [sx, sy] = dir
  const ahead = rects.map((r, i) => i).filter((i) => i !== from && (sx ? (cx(rects[i]) - cx(cur)) * sx > 0 : (cy(rects[i]) - cy(cur)) * sy > 0))
  // Along a column (up/down) only tiles above or below it count; along a row (left/right) prefer tiles on the same band.
  const lined = ahead.filter((i) => (sx ? overlapY(rects[i], cur) : overlapX(rects[i], cur)))
  const pool = sy ? lined : lined.length ? lined : ahead
  let best = from
  let bestScore = Infinity
  for (const i of pool) {
    const dx = Math.abs(cx(rects[i]) - cx(cur))
    const dy = Math.abs(cy(rects[i]) - cy(cur))
    const score = sx ? dx + 3 * dy : dy + 3 * dx
    if (score < bestScore) { bestScore = score; best = i }
  }
  return best
}
