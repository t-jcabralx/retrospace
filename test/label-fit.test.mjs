import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { fitLabel, wrapWords, GLYPH, LINE } from '../src/ui/event/labelFit.js'

describe('wrapWords', () => {
  test('fills a line with whole words, then starts the next', () => {
    assert.deepEqual(wrapWords('Starbucks gift card', 9), ['Starbucks', 'gift card'])
    assert.deepEqual(wrapWords('a b c d', 3), ['a b', 'c d'])
    assert.deepEqual(wrapWords('one', 10), ['one'])
  })
  test('a word longer than the line stays whole, and blanks and odd spacing are ignored', () => {
    assert.deepEqual(wrapWords('Christopher Villanueva-Mendoza', 8), ['Christopher', 'Villanueva-Mendoza'])
    assert.deepEqual(wrapWords('  spaced   out  ', 20), ['spaced out'])
    assert.deepEqual(wrapWords('', 5), [])
    assert.deepEqual(wrapWords('x y', 0), ['x', 'y'], 'a nonsense width still gives one word per line')
  })
})

describe('fitLabel', () => {
  test('short names get the biggest size and one line when there is room', () => {
    const f = fitLabel('Ana', { length: 48, width: 30, max: 12 })
    assert.deepEqual(f, { lines: ['Ana'], size: 12, cut: false })
  })

  test('a two-word name wraps to two lines rather than shrinking to nothing', () => {
    const f = fitLabel('Maria Santos', { length: 48, width: 28, max: 12 })
    assert.deepEqual(f.lines, ['Maria', 'Santos'])
    assert.ok(f.size >= 11 && f.cut === false)
  })

  test('a long prize name wraps onto more lines at a smaller size, and nothing is cut while it fits', () => {
    const f = fitLabel('Starbucks gift card', { length: 60, width: 60, max: 13 })
    assert.deepEqual(f.lines, ['Starbucks', 'gift card'])
    assert.equal(f.cut, false)
    for (const l of f.lines) assert.ok(Array.from(l).length * GLYPH * f.size <= 60 + 0.001, 'each line fits the length')
    assert.ok(f.lines.length * f.size * LINE <= 60, 'the lines fit the width')
  })

  test('when even the smallest size cannot hold it, the last line is cut with an ellipsis and it says so', () => {
    const f = fitLabel('Christopher Villanueva-Mendoza', { length: 48, width: 24, max: 12 })
    assert.equal(f.cut, true)
    assert.equal(f.size, 9)
    assert.ok(f.lines.length <= 2)
    assert.ok(f.lines.some((l) => l.endsWith('…')))
    for (const l of f.lines) assert.ok(Array.from(l).length <= Math.floor(48 / (GLYPH * 9)), 'no line is longer than the room')
  })

  test('more words than lines: the cut falls on the last line that fits', () => {
    const f = fitLabel('one two three four five six seven eight nine ten', { length: 40, width: 20, max: 11 })
    assert.equal(f.cut, true)
    assert.equal(f.lines.length, 1)
    assert.ok(f.lines[0].endsWith('…'))
  })

  test('emoji count as one letter each, and blank text gives nothing to draw', () => {
    assert.deepEqual(fitLabel('🍕 Pizza', { length: 80, width: 30, max: 12 }).lines, ['🍕 Pizza'])
    assert.deepEqual(fitLabel('   ', { length: 50, width: 30, max: 12 }), { lines: [], size: 9, cut: false })
    assert.deepEqual(fitLabel(undefined, { length: 50, width: 30, max: 12 }).lines, [])
  })

  test('it never returns a size outside min..max, never more than the allowed lines, and always something for a real name', () => {
    for (const text of ['A', 'Jo Li', 'Maria Santos', 'Grand prize: smartwatch', 'x'.repeat(60), 'a b c d e f g h i j k l m n o p']) {
      for (const [length, width] of [[20, 10], [48, 24], [60, 60], [200, 200]]) {
        const f = fitLabel(text, { length, width, max: 14, min: 9, maxLines: 3 })
        assert.ok(f.size >= 9 && f.size <= 14, `${text} ${length}x${width}`)
        assert.ok(f.lines.length >= 1 && f.lines.length <= 3, `${text} ${length}x${width}`)
      }
    }
  })
})
