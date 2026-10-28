// Pure canvas math, no DOM. view = { x, y, scale }: world point p appears at screen p * scale + (x, y).
export const MIN_SCALE = 0.1
export const MAX_SCALE = 4

export const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

export const screenToWorld = (pt, view) => ({ x: (pt.x - view.x) / view.scale, y: (pt.y - view.y) / view.scale })
export const worldToScreen = (pt, view) => ({ x: pt.x * view.scale + view.x, y: pt.y * view.scale + view.y })

// Zooms by `factor` around a screen point, which keeps pointing at the same world point.
export function zoomAt(view, screenPt, factor) {
  const scale = clampScale(view.scale * factor)
  const k = scale / view.scale
  return { x: screenPt.x - (screenPt.x - view.x) * k, y: screenPt.y - (screenPt.y - view.y) * k, scale }
}

// Strict overlap: rectangles that only share an edge do not intersect.
export const rectsIntersect = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export const itemsInRect = (items, rect) => items.filter((i) => rectsIntersect(i, rect))

// Items that sit completely inside `frame` (connectors and the frame itself never count).
export const itemsFullyInside = (frame, items) =>
  items.filter((i) => i.id !== frame.id && i.kind !== 'connector'
    && i.x >= frame.x && i.y >= frame.y && i.x + i.w <= frame.x + frame.w && i.y + i.h <= frame.y + frame.h)

export function boundsOf(items) {
  if (!items.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const i of items) {
    x0 = Math.min(x0, i.x); y0 = Math.min(y0, i.y)
    x1 = Math.max(x1, i.x + i.w); y1 = Math.max(y1, i.y + i.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function centerOn(view, size, worldPt) {
  return { ...view, x: size.w / 2 - worldPt.x * view.scale, y: size.h / 2 - worldPt.y * view.scale }
}

// The view that shows all of `bounds` with `padding` px around it; never magnifies past maxScale.
export function fitView(bounds, size, padding = 80, maxScale = 1) {
  const aw = Math.max(1, size.w - padding * 2)
  const ah = Math.max(1, size.h - padding * 2)
  const scale = clampScale(Math.min(aw / Math.max(1, bounds.w), ah / Math.max(1, bounds.h), maxScale))
  return centerOn({ x: 0, y: 0, scale }, size, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 })
}

// Edge midpoints with the outward normal of each edge: the anchors connectors attach to.
const anchors = (i) => [
  { x: i.x + i.w / 2, y: i.y, nx: 0, ny: -1 },
  { x: i.x + i.w, y: i.y + i.h / 2, nx: 1, ny: 0 },
  { x: i.x + i.w / 2, y: i.y + i.h, nx: 0, ny: 1 },
  { x: i.x, y: i.y + i.h / 2, nx: -1, ny: 0 },
]
const round = (n) => Math.round(n * 100) / 100

// Cubic from the nearest pair of edge midpoints; control points lean out of each edge so the line leaves
// and enters perpendicular to it (and the arrowhead points into the target).
export function connectorPath(fromItem, toItem) {
  let best = null
  for (const a of anchors(fromItem)) {
    for (const b of anchors(toItem)) {
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      if (!best || d < best.d) best = { a, b, d }
    }
  }
  const { a, b } = best
  const lean = Math.max(40, Math.sqrt(best.d) * 0.4)
  const p = [a.x, a.y, a.x + a.nx * lean, a.y + a.ny * lean, b.x + b.nx * lean, b.y + b.ny * lean, b.x, b.y].map(round)
  return `M ${p[0]} ${p[1]} C ${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}`
}

// New rect after dragging `handle` ('n','ne','e','se','s','sw','w','nw') by (dx, dy) world units.
// keepAspect applies to corners only; the corner opposite the handle stays put.
export function resizeRect(rect, handle, dx, dy, { min = 24, keepAspect = false } = {}) {
  const west = handle.includes('w'), east = handle.includes('e')
  const north = handle.includes('n'), south = handle.includes('s')
  let { x, y, w, h } = rect
  if (keepAspect && handle.length === 2) {
    const ratio = rect.w / rect.h
    w = Math.max(min, rect.w + (west ? -dx : dx))
    h = w / ratio
    if (h < min) { h = min; w = h * ratio }
    return { x: west ? rect.x + rect.w - w : rect.x, y: north ? rect.y + rect.h - h : rect.y, w, h }
  }
  if (east) w = Math.max(min, rect.w + dx)
  if (west) { w = Math.max(min, rect.w - dx); x = rect.x + rect.w - w }
  if (south) h = Math.max(min, rect.h + dy)
  if (north) { h = Math.max(min, rect.h - dy); y = rect.y + rect.h - h }
  return { x, y, w, h }
}
