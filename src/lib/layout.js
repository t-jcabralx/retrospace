// Pure placement and sizing for celebration cards. Browser-safe, no DOM.
export const CARD_W = 300
export const CARD_GRID = Object.freeze({ cols: 4, colW: 320, gap: 24, top: 220 })

const PAD = 16 // keep in step with .bd-card in board.css
const LINE = 24 // 17px text at 1.4
const CHAR_W = 9 // a little over the average glyph, so a long message errs on the tall side
const WIDE = 1.9 // CJK, fullwidth forms and emoji are about this many Latin glyphs wide
const SIGNER = 30 // margin plus the '— name' line
const MEDIA_GAP = 12
const MIN_H = 120
const MAX_H = 1200

const pos = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback)

// Where the next card goes: masonry by shortest column. Column i starts at x = i * colW; a card belongs to the column
// nearest to its x (so a nudged or dragged card still counts), a card far outside the grid is ignored, and a column's
// bottom edge is the lowest y + h of its cards (never above the top line). Ties go to the leftmost column.
export function nextCardSlot(cards, opts = {}) {
  const cols = Number.isInteger(opts.cols) && opts.cols > 0 ? opts.cols : CARD_GRID.cols
  const colW = pos(opts.colW, CARD_GRID.colW)
  const gap = Number.isFinite(opts.gap) && opts.gap >= 0 ? opts.gap : CARD_GRID.gap
  const top = Number.isFinite(opts.top) ? opts.top : CARD_GRID.top
  const bottoms = Array.from({ length: cols }, () => top - gap) // an empty column "ends" one gap above the top line
  const inGrid = []
  for (const c of cards ?? []) {
    if (c?.kind !== 'card' || c.deleted || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.h)) continue
    const col = Math.round(c.x / colW)
    if (col >= 0 && col < cols) inGrid.push({ col, y: c.y, h: c.h })
  }
  // A card can be put anywhere by anyone (the server only clamps coordinates), so one at y = 100000 would push every new card
  // out of sight. Filling the shortest column keeps the columns level: the lowest edge a fair layout can reach is the average
  // column height plus one card, so a card whose top is more than three more cards below that is not part of the layout.
  const clampH = (h) => Math.min(MAX_H, Math.max(0, h))
  const total = inGrid.reduce((n, c) => n + clampH(c.h) + gap, 0)
  const heights = inGrid.map((c) => clampH(c.h)).sort((a, b) => b - a)
  for (const c of inGrid) {
    const others = total - clampH(c.h) - gap
    const tallest = Math.max(MIN_H, clampH(c.h) === heights[0] ? (heights[1] ?? 0) : heights[0]) // the tallest of the OTHER cards
    if (c.y > top + others / cols + tallest + 3 * tallest) continue
    bottoms[c.col] = Math.max(bottoms[c.col], c.y + c.h)
  }
  let best = 0
  for (let i = 1; i < cols; i++) if (bottoms[i] < bottoms[best]) best = i
  return { x: best * colW, y: bottoms[best] + gap }
}

// Display width of a text in Latin glyphs: wide characters (CJK, Hangul, fullwidth forms, emoji) count WIDE, the rest 1.
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
export function textWidth(text) {
  let w = 0
  for (const ch of String(text ?? '')) w += WIDE_RE.test(ch) ? WIDE : 1
  return w
}

// The height to create a card with, from its text and media. An estimate (text wraps differently per font): the card
// is overflow-hidden and the author can resize it. mediaRatio is width / height of the GIF or photo.
export function estimateCardHeight({ message = '', hasMedia = false, mediaRatio, width = CARD_W } = {}) {
  const inner = Math.max(40, (Number.isFinite(width) && width > 2 * PAD ? width : CARD_W) - 2 * PAD)
  const perLine = Math.max(8, Math.floor(inner / CHAR_W))
  const lines = String(message ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(textWidth(line) / perLine)), 0)
  let h = PAD + lines * LINE + SIGNER + PAD
  if (hasMedia) {
    const ratio = Math.min(3, Math.max(0.4, Number.isFinite(mediaRatio) && mediaRatio > 0 ? mediaRatio : 4 / 3))
    h += MEDIA_GAP + Math.round(inner / ratio)
  }
  return Math.min(MAX_H, Math.max(MIN_H, Math.round(h)))
}
