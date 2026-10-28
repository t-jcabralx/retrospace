import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCardOp } from '../src/ui/cardOps.js'
import { validateOp } from '../src/lib/validate.js'
import { CARD_W } from '../src/lib/layout.js'

const base = { message: '  Happy birthday, Sam!  ', signer: ' Alex ', color: 'pink' }

test('a text card lands in the first column at the top line, 300 wide, and the server accepts it', () => {
  const op = buildCardOp([], base)
  assert.equal(op.op, 'add')
  assert.equal(op.item.kind, 'card')
  assert.deepEqual([op.item.x, op.item.y, op.item.w], [0, 220, CARD_W])
  assert.ok(op.item.h >= 120)
  assert.deepEqual(op.item.data, { message: 'Happy birthday, Sam!', signer: 'Alex', color: 'pink' })
  assert.equal(validateOp(op).ok, true)
})

test('a GIF card stores the https url and its size, and is taller than the text-only card', () => {
  const text = buildCardOp([], base)
  const op = buildCardOp([], { ...base, media: { type: 'gif', src: 'https://media.giphy.com/media/x/200.gif', w: 356, h: 200 } })
  assert.deepEqual(op.item.data, { message: 'Happy birthday, Sam!', signer: 'Alex', color: 'pink', gif: 'https://media.giphy.com/media/x/200.gif', mediaW: 356, mediaH: 200 })
  assert.ok(op.item.h > text.item.h + 100)
  assert.equal(validateOp(op).ok, true)
})

test('a photo goes to data.image; an unknown size leaves the size hints out', () => {
  const op = buildCardOp([], { ...base, media: { type: 'photo', src: 'data:image/webp;base64,AAAA' } })
  assert.equal(op.item.data.image, 'data:image/webp;base64,AAAA')
  assert.ok(!('gif' in op.item.data) && !('mediaW' in op.item.data))
  assert.equal(validateOp(op).ok, true)
})

test('cards fill the columns left to right, then the shortest one; each gets a fresh id and a higher z', () => {
  const items = []
  const ids = new Set()
  const cols = []
  for (let i = 0; i < 6; i++) {
    const op = buildCardOp(items, base)
    ids.add(op.id)
    cols.push(op.item.x)
    items.push({ ...op.item, ...op.item })
  }
  assert.deepEqual(cols, [0, 320, 640, 960, 0, 320])
  assert.equal(ids.size, 6)
  assert.deepEqual(items.map((i) => i.z), [1, 2, 3, 4, 5, 6])
  // no two cards overlap
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const A = items[a], B = items[b]
    assert.ok(!(A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h), `${a} overlaps ${b}`)
  }
})

test('other kinds on the board do not move the slot, and a given id is used', () => {
  const op = buildCardOp([{ id: 'n', kind: 'note', x: 0, y: 220, w: 180, h: 900, z: 4 }], base, 'my-id')
  assert.equal(op.id, 'my-id')
  assert.deepEqual([op.item.x, op.item.y, op.item.z], [0, 220, 5])
})
