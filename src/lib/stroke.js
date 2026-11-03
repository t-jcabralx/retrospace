// The highlighter pen: a stroke is an item of kind `stroke`. Its box (x, y, w, h) holds the scribble, and data.pts is the path
// in that box as flat whole numbers 0..1000 ([x0, y0, x1, y1, ...]) so resizing the item simply stretches it. Pure; shared by
// the server rules (validate.js) and the board UI.
export const MAX_POINTS = 300
export const MIN_POINTS = 2
export const COORD_MAX = 1000
export const STROKE_WIDTH = 18 // world pixels
export const MIN_BOX = 24 // a flat line still gets a box this thick, so it can be picked and resized

const isInt = (n) => Number.isInteger(n)

// The data check the validator runs. `colors` is the list of note colours (passed in so this file stays free of imports).
export function checkStrokeData(d, colors) {
  if (!Array.isArray(d.pts) || d.pts.length % 2 !== 0) return 'stroke needs pts as pairs of numbers'
  if (d.pts.length < MIN_POINTS * 2 || d.pts.length > MAX_POINTS * 2) return `stroke needs ${MIN_POINTS} to ${MAX_POINTS} points`
  if (!d.pts.every((n) => isInt(n) && n >= 0 && n <= COORD_MAX)) return `stroke points must be whole numbers from 0 to ${COORD_MAX}`
  if (!colors.includes(d.color)) return 'stroke color must be one of the note colors'
  if (d.width !== undefined && !(isInt(d.width) && d.width >= 4 && d.width <= 60)) return 'stroke width must be 4 to 60'
  return null
}

// World points -> fewer points: any closer than `minDist` to the one before are dropped, then an even sample if still over the cap
// (the last point is always kept, so the end of the stroke is where the hand lifted).
export function simplify(points, { minDist = 3, max = MAX_POINTS } = {}) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p)
  }
  const end = points[points.length - 1]
  if (end && out[out.length - 1] !== end && out.length) out.push(end)
  if (out.length <= max) return out
  const step = (out.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => out[Math.round(i * step)])
}

// World points -> { rect, data } for an add op, or null when there is nothing worth keeping (a tap). The box is the scribble
// grown by half the pen's width; a stroke that is nearly flat gets a box at least MIN_BOX thick.
export function buildStroke(points, { color = 'yellow', width = STROKE_WIDTH } = {}) {
  const pts = simplify(points)
  if (pts.length < MIN_POINTS) return null
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const pad = width / 2
  let x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
  let w = Math.max(...xs) + pad - x, h = Math.max(...ys) + pad - y
  if (w < MIN_BOX) { x -= (MIN_BOX - w) / 2; w = MIN_BOX }
  if (h < MIN_BOX) { y -= (MIN_BOX - h) / 2; h = MIN_BOX }
  const flat = pts.flatMap((p) => [Math.round(((p.x - x) / w) * COORD_MAX), Math.round(((p.y - y) / h) * COORD_MAX)])
  return { rect: { x, y, w, h }, data: { pts: flat, color, width } }
}

// The SVG path for data.pts, in the 0..1000 box.
export function strokePath(pts) {
  if (!Array.isArray(pts) || pts.length < 4) return ''
  let d = `M${pts[0]} ${pts[1]}`
  for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`
  return d
}
