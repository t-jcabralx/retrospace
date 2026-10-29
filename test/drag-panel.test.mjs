import test from 'node:test'
import assert from 'node:assert/strict'
import { clampOffset, isDrag, DRAG_SLOP } from '../src/ui/useDragPanel.js'

const rect = { left: 100, top: 50, width: 300, height: 80 }
const base = { x: 0, y: 0 }
const [VW, VH] = [1000, 700]

test('a drag inside the window moves the panel by exactly the distance dragged', () => {
  assert.deepEqual(clampOffset(rect, base, 40, 30, VW, VH), { x: 40, y: 30 })
  assert.deepEqual(clampOffset(rect, base, -20, 100, VW, VH), { x: -20, y: 100 })
})

test('the panel can never be dragged out of reach: 56 px of it always stays inside the window', () => {
  assert.deepEqual(clampOffset(rect, base, 5000, 5000, VW, VH), { x: 1000 - 56 - 100, y: 700 - 56 - 50 })
  assert.deepEqual(clampOffset(rect, base, -5000, -5000, VW, VH), { x: 56 - 300 - 100, y: -50 }, 'left edge may leave the window, but the top may not')
})

test('an existing offset is kept: the new offset is the old one plus how far the panel actually moved', () => {
  const placed = { left: 140, top: 80, width: 300, height: 80 } // already moved by (40, 30)
  assert.deepEqual(clampOffset(placed, { x: 40, y: 30 }, 10, 10, VW, VH), { x: 50, y: 40 })
  assert.deepEqual(clampOffset(placed, { x: 40, y: 30 }, 5000, 0, VW, VH), { x: 40 + (1000 - 56 - 140), y: 30 })
})

test('a window smaller than the panel brings it back (the offset is re-fitted with no movement)', () => {
  const far = { left: 900, top: 600, width: 300, height: 80 } // pushed right and down, then the window shrank
  const fit = clampOffset(far, { x: 800, y: 550 }, 0, 0, 800, 500)
  assert.ok(far.left + (fit.x - 800) <= 800 - 56 && far.top + (fit.y - 550) <= 500 - 56)
})

test('a press on the card is a tap until it has moved more than 6 px, then it is a drag', () => {
  assert.equal(DRAG_SLOP, 6)
  assert.equal(isDrag(0, 0), false)
  assert.equal(isDrag(3, 4), false, 'exactly 5 px')
  assert.equal(isDrag(4, 5), true)
  assert.equal(isDrag(-20, 0), true)
})
