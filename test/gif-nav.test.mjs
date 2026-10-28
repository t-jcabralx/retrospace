import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTile, readingOrder } from '../src/ui/gifNav.js'

// Three masonry columns, 100 wide with 10px gutters; tile heights differ, so rows do not line up.
const tiles = [
  { left: 0, top: 0, width: 100, height: 80 },    // 0  col 0
  { left: 110, top: 0, width: 100, height: 120 }, // 1  col 1
  { left: 220, top: 0, width: 100, height: 60 },  // 2  col 2
  { left: 0, top: 90, width: 100, height: 100 },  // 3  col 0
  { left: 220, top: 70, width: 100, height: 90 }, // 4  col 2
  { left: 110, top: 130, width: 100, height: 70 }, // 5  col 1
]

test('right and left move to the neighbouring column, to the tile that is nearest vertically', () => {
  assert.equal(nextTile(tiles, 0, 'ArrowRight'), 1)
  assert.equal(nextTile(tiles, 1, 'ArrowRight'), 2)
  assert.equal(nextTile(tiles, 3, 'ArrowRight'), 5, 'tile 3 (top 90) is nearest to tile 5 (top 130) rather than tile 1')
  assert.equal(nextTile(tiles, 4, 'ArrowLeft'), 5)
  assert.equal(nextTile(tiles, 1, 'ArrowLeft'), 0)
})

test('down and up stay in the column', () => {
  assert.equal(nextTile(tiles, 0, 'ArrowDown'), 3)
  assert.equal(nextTile(tiles, 3, 'ArrowUp'), 0)
  assert.equal(nextTile(tiles, 2, 'ArrowDown'), 4)
  assert.equal(nextTile(tiles, 1, 'ArrowDown'), 5)
})

test('at an edge the focus stays where it is', () => {
  assert.equal(nextTile(tiles, 0, 'ArrowLeft'), 0)
  assert.equal(nextTile(tiles, 2, 'ArrowRight'), 2)
  assert.equal(nextTile(tiles, 0, 'ArrowUp'), 0)
  assert.equal(nextTile(tiles, 3, 'ArrowDown'), 3)
})

test('home and end go to the first and last tile in reading order', () => {
  assert.equal(nextTile(tiles, 4, 'Home'), 0)
  assert.equal(nextTile(tiles, 0, 'End'), 5)
  assert.deepEqual(readingOrder(tiles), [0, 1, 2, 4, 3, 5])
})

test('a single tile, no tiles and unknown keys are harmless', () => {
  assert.equal(nextTile([tiles[0]], 0, 'ArrowDown'), 0)
  assert.equal(nextTile([], 0, 'ArrowDown'), -1)
  assert.equal(nextTile(tiles, 2, 'a'), 2)
  assert.equal(nextTile(tiles, -1, 'ArrowDown'), 0, 'from nowhere, the first tile')
  assert.equal(nextTile(tiles, 99, 'ArrowDown'), 0)
})
