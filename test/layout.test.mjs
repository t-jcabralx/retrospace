import test from 'node:test'
import assert from 'node:assert/strict'
import { nextCardSlot, estimateCardHeight, CARD_W, CARD_GRID } from '../src/lib/layout.js'

const OPTS = { cols: 4, colW: 320, gap: 24, top: 220 }
const card = (col, y, h, extra = {}) => ({ id: `c${col}-${y}`, kind: 'card', x: col * 320, y, w: 300, h, ...extra })

test('an empty board puts the first card in the first column at the top line', () => {
  assert.deepEqual(nextCardSlot([], OPTS), { x: 0, y: 220 })
  assert.deepEqual(nextCardSlot(undefined, OPTS), { x: 0, y: 220 })
})

test('defaults match the documented grid', () => {
  assert.deepEqual(CARD_GRID, OPTS)
  assert.equal(CARD_W, 300)
  assert.deepEqual(nextCardSlot([]), { x: 0, y: 220 })
})

test('empty columns are filled left to right before any column gets a second card', () => {
  const placed = []
  const slots = []
  for (let i = 0; i < 4; i++) {
    const s = nextCardSlot(placed, OPTS)
    slots.push(s)
    placed.push({ ...s, kind: 'card', w: 300, h: 200 })
  }
  assert.deepEqual(slots.map((s) => s.x), [0, 320, 640, 960])
  assert.ok(slots.every((s) => s.y === 220))
})

test('the next card goes under the column with the smallest bottom edge, with the gap', () => {
  const cards = [card(0, 220, 400), card(1, 220, 150), card(2, 220, 300), card(3, 220, 250)]
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 320, y: 220 + 150 + 24 })
})

test('equal bottom edges go to the leftmost column', () => {
  const cards = [card(0, 220, 200), card(1, 220, 200), card(2, 220, 200), card(3, 220, 200)]
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 0, y: 220 + 200 + 24 })
  const uneven = [card(0, 220, 300), card(1, 220, 200), card(2, 220, 200), card(3, 220, 400)]
  assert.deepEqual(nextCardSlot(uneven, OPTS), { x: 320, y: 444 })
})

test('mixed heights: a column that holds several cards is measured by its lowest bottom edge', () => {
  const cards = [
    card(0, 220, 100), card(0, 344, 100), card(0, 468, 100), // column 0 ends at 568
    card(1, 220, 380), // column 1 ends at 600
    card(2, 220, 120), card(2, 364, 120), // column 2 ends at 484
    card(3, 220, 300), // column 3 ends at 520
  ]
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 640, y: 484 + 24 })
})

test('a dragged card still counts toward the column it is nearest to', () => {
  const cards = [card(0, 220, 200), card(1, 220, 200), card(2, 220, 200), card(3, 220, 200)]
  // column 0's card was dragged 90px right and 500px down: nearest column is still 0, and its bottom edge is now the lowest
  cards[0] = { ...cards[0], x: 90, y: 720 }
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 320, y: 444 })
})

test('cards dragged out of the grid (far left/right, or above the top line) do not push anything', () => {
  const cards = [card(0, 220, 200), { id: 'far', kind: 'card', x: 5000, y: 3000, w: 300, h: 900 }, { id: 'left', kind: 'card', x: -2000, y: 4000, w: 300, h: 900 }, { id: 'up', kind: 'card', x: 320, y: -400, w: 300, h: 200 }]
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 320, y: 220 })
})

test('other kinds and deleted items are ignored, and the input is not mutated', () => {
  const cards = [{ id: 'n', kind: 'note', x: 0, y: 220, w: 180, h: 900 }, { ...card(0, 220, 900), deleted: true }, card(1, 220, 100)]
  const copy = structuredClone(cards)
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 0, y: 220 })
  assert.deepEqual(cards, copy)
})

test('custom grids work and bad options fall back to defaults', () => {
  assert.deepEqual(nextCardSlot([], { cols: 2, colW: 100, gap: 10, top: 0 }), { x: 0, y: 0 })
  const two = [{ kind: 'card', x: 0, y: 0, w: 90, h: 50 }]
  assert.deepEqual(nextCardSlot(two, { cols: 2, colW: 100, gap: 10, top: 0 }), { x: 100, y: 0 })
  assert.deepEqual(nextCardSlot([], { cols: 0, colW: NaN }), { x: 0, y: 220 })
})

test('estimateCardHeight grows with the text and with media, and is a whole number in a sane range', () => {
  const short = estimateCardHeight({ message: 'Happy birthday!', hasMedia: false, width: CARD_W })
  const long = estimateCardHeight({ message: 'word '.repeat(80), hasMedia: false, width: CARD_W })
  assert.ok(Number.isInteger(short) && short >= 120 && short < 260, String(short))
  assert.ok(long > short + 150, `${long} vs ${short}`)
  const wide = estimateCardHeight({ message: 'Happy birthday!', hasMedia: true, mediaRatio: 2, width: CARD_W })
  const tall = estimateCardHeight({ message: 'Happy birthday!', hasMedia: true, mediaRatio: 0.5, width: CARD_W })
  assert.ok(wide > short && tall > wide)
  assert.ok(wide - short >= 100, 'a 2:1 gif adds about 134px')
})

test('estimateCardHeight counts hard line breaks and tolerates junk', () => {
  const three = estimateCardHeight({ message: 'a\nb\nc', hasMedia: false })
  const six = estimateCardHeight({ message: 'a\nb\nc\nd\ne\nf', hasMedia: false })
  assert.ok(six >= three + 3 * 20, `${six} vs ${three}`)
  assert.equal(estimateCardHeight({}), estimateCardHeight({ message: '', hasMedia: false }))
  const odd = estimateCardHeight({ message: 'x', hasMedia: true, mediaRatio: 0, width: 300 })
  assert.ok(Number.isFinite(odd) && odd < 1200)
  const huge = estimateCardHeight({ message: 'x'.repeat(5000), hasMedia: true, mediaRatio: 0.01, width: 10 })
  assert.ok(huge <= 1200)
})

// --- round 1: hostile placement and wide text --------------------------------------------------------------------
test('one card posted far below the grid (y = 1e5) cannot push every new card away', () => {
  const hostile = { id: 'h', kind: 'card', x: 0, y: 100000, w: 300, h: 200 }
  assert.deepEqual(nextCardSlot([hostile], OPTS), { x: 0, y: 220 })
  const cards = [card(0, 220, 200), card(1, 220, 200), card(2, 220, 200), card(3, 220, 200), hostile, { ...hostile, id: 'h2', x: 320, y: 90000 }]
  assert.deepEqual(nextCardSlot(cards, OPTS), { x: 0, y: 444 }, 'placed as if the hostile cards were not there')
})

test('a card far below a small board is ignored, a legitimately tall column never is', () => {
  const ten = Array.from({ length: 10 }, (_, i) => card(i % 4, 220 + Math.floor(i / 4) * 224, 200))
  const far = { id: 'far', kind: 'card', x: 640, y: 3000, w: 300, h: 200 }
  const base = nextCardSlot(ten, OPTS)
  assert.deepEqual(nextCardSlot([...ten, far], OPTS), base)
  // 80 cards of random heights placed one after the other: none may ever be mistaken for hostile, and none may overlap
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const placed = []
  for (let i = 0; i < 80; i++) {
    const slot = nextCardSlot(placed, OPTS)
    placed.push({ id: `p${i}`, kind: 'card', ...slot, w: 300, h: Math.round(120 + rnd() * 700) })
  }
  for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
    const A = placed[a], B = placed[b]
    assert.ok(!(A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h), `${a} overlaps ${b}`)
  }
})

test('a huge card (h = 4000) at a believable y does not count more than its place allows', () => {
  const giant = { id: 'g', kind: 'card', x: 0, y: 5000, w: 300, h: 4000 }
  assert.deepEqual(nextCardSlot([giant], OPTS), { x: 0, y: 220 })
})

test('estimateCardHeight counts wide characters (CJK, fullwidth, emoji) about twice as wide', () => {
  const latin = estimateCardHeight({ message: 'a'.repeat(100) })
  const cjk = estimateCardHeight({ message: '祝你生日快乐'.repeat(17).slice(0, 100) })
  const emoji = estimateCardHeight({ message: '🎉'.repeat(100) })
  assert.ok(cjk >= latin + 3 * 24, `${cjk} vs ${latin}`)
  assert.ok(emoji >= latin + 3 * 24)
  const long = estimateCardHeight({ message: '誕'.repeat(500) })
  assert.ok(long >= 700 && long <= 1200, String(long))
  const mixed = estimateCardHeight({ message: 'Happy 生日 🎂 '.repeat(20) })
  assert.ok(mixed > estimateCardHeight({ message: 'Happy sh 12 '.repeat(20) }))
  assert.equal(estimateCardHeight({ message: 'é'.repeat(100) }), latin, 'accented Latin is not wide')
})
