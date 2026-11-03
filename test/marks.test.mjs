import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { normalizeMarks, rebaseMarks, applyMark, segments, toCharIndex, charLength, MAX_MARKS, MARK_COLORS } from '../src/lib/marks.js'
import { validateItem } from '../src/lib/validate.js'
import { planOps } from '../src/lib/plan.js'
import { initialState, reducer, undo } from '../src/client/state.js'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: ItemView } = await import('../src/ui/ItemView.jsx')

const m = (s, e, c = 'yellow') => ({ s, e, c })

describe('normalizeMarks', () => {
  test('anything wrong is dropped, the rest is clipped, sorted, trimmed of overlaps and joined', () => {
    assert.deepEqual(normalizeMarks('hello', 'nope'), [])
    assert.deepEqual(normalizeMarks('hello', undefined), [])
    const messy = [null, 'x', { s: 1.5, e: 3, c: 'yellow' }, { s: 0, e: 3, c: 'plaid' }, { s: 2, e: 2, c: 'pink' }, { s: 4, e: 99, c: 'blue' }, { s: -5, e: 2, c: 'green' }]
    assert.deepEqual(normalizeMarks('hello', messy), [m(0, 2, 'green'), m(4, 5, 'blue')])
    assert.deepEqual(normalizeMarks('hello world', [m(0, 5), m(3, 8, 'pink')]), [m(0, 5), m(5, 8, 'pink')], 'the later one is trimmed')
    assert.deepEqual(normalizeMarks('hello world', [m(0, 3), m(3, 6)]), [m(0, 6)], 'touching marks of one colour join')
    assert.deepEqual(normalizeMarks('hello world', [m(0, 3), m(3, 6, 'pink')]), [m(0, 3), m(3, 6, 'pink')])
  })

  test('at most 20 are kept, and every colour is one of the four', () => {
    const many = Array.from({ length: 40 }, (_, i) => m(i * 2, i * 2 + 1, i % 2 ? 'pink' : 'blue'))
    assert.equal(normalizeMarks('x'.repeat(100), many).length, MAX_MARKS)
    assert.deepEqual(MARK_COLORS, ['yellow', 'green', 'pink', 'blue'])
  })

  test('positions count whole characters, so an emoji is one', () => {
    assert.equal(charLength('a😀b'), 3)
    assert.equal(toCharIndex('a😀b', 3), 2, 'UTF-16 index 3 is after the emoji')
    assert.deepEqual(normalizeMarks('a😀b', [m(0, 3)]), [m(0, 3)])
    assert.deepEqual(segments('a😀b', [m(1, 2)]), [{ text: 'a', color: null }, { text: '😀', color: 'yellow' }, { text: 'b', color: null }])
  })
})

describe('rebaseMarks: marks stay on their words while the text is edited', () => {
  const marks = [m(6, 11, 'pink')] // "world" in "hello world"
  test('typing before moves them, typing after leaves them', () => {
    assert.deepEqual(rebaseMarks('hello world', 'oh hello world', marks), [m(9, 14, 'pink')])
    assert.deepEqual(rebaseMarks('hello world', 'hello world!!', marks), marks)
  })
  test('typing inside a marked word makes the word longer', () => {
    assert.deepEqual(rebaseMarks('hello world', 'hello wor-ld', marks), [m(6, 12, 'pink')])
  })
  test('deleting part of a marked word trims it, deleting all of it removes it', () => {
    assert.deepEqual(rebaseMarks('hello world', 'hello wld', marks), [m(6, 9, 'pink')])
    assert.deepEqual(rebaseMarks('hello world', 'hello ', marks), [])
  })
  test('replacing a stretch that cuts a mark keeps its outside parts', () => {
    assert.deepEqual(rebaseMarks('abcdefgh', 'abXXefgh', [m(1, 7)]), [m(1, 2), m(4, 7)])
  })
  test('no marks, or no change, is simple', () => {
    assert.deepEqual(rebaseMarks('a', 'ab', []), [])
    assert.deepEqual(rebaseMarks('same', 'same', [m(0, 2)]), [m(0, 2)])
    assert.deepEqual(rebaseMarks('a😀b', 'a😀bc', [m(1, 2)]), [m(1, 2)])
  })
})

describe('applyMark', () => {
  test('adds a colour to a stretch, and a different colour replaces it where they overlap', () => {
    assert.deepEqual(applyMark([], 0, 5, 'yellow', 20), [m(0, 5)])
    assert.deepEqual(applyMark([m(0, 5)], 3, 8, 'pink', 20), [m(0, 3), m(3, 8, 'pink')])
    assert.deepEqual(applyMark([m(0, 10)], 3, 6, 'green', 20), [m(0, 3), m(3, 6, 'green'), m(6, 10)], 'a new colour splits the old mark')
  })
  test('the same colour over a stretch that already has it takes it off; null always does', () => {
    assert.deepEqual(applyMark([m(0, 10)], 3, 6, 'yellow', 20), [m(0, 3), m(6, 10)])
    assert.deepEqual(applyMark([m(0, 4), m(4, 8)], 2, 6, 'yellow', 20), [m(0, 2), m(6, 8)], 'touching marks count as covering')
    assert.deepEqual(applyMark([m(0, 10, 'pink')], 3, 6, null, 20), [m(0, 3, 'pink'), m(6, 10, 'pink')])
    assert.deepEqual(applyMark([m(0, 4)], 3, 8, 'yellow', 20), [m(0, 8)], 'partly covered: the colour is added to the rest')
  })
  test('the selection may be backwards, is clipped to the text, and an empty one changes nothing', () => {
    assert.deepEqual(applyMark([], 5, 0, 'blue', 20), [m(0, 5, 'blue')])
    assert.deepEqual(applyMark([], 15, 30, 'blue', 20), [m(15, 20, 'blue')], 'clipped to the end of the text')
    assert.deepEqual(applyMark([], 25, 30, 'blue', 20), [], 'wholly past the end: nothing')
    assert.deepEqual(applyMark([m(0, 2)], 4, 4, 'pink', 20), [m(0, 2)])
  })
  test('what is returned is always valid', () => {
    const out = applyMark(applyMark([m(0, 3), m(10, 12, 'green')], 2, 11, 'pink', 30), 0, 1, null, 30)
    assert.deepEqual(out, normalizeMarks('x'.repeat(30), out))
  })
})

describe('segments', () => {
  test('pieces in order, plain where there is no mark, and the whole text when there are none', () => {
    assert.deepEqual(segments('hello world', [m(6, 11, 'blue')]), [{ text: 'hello ', color: null }, { text: 'world', color: 'blue' }])
    assert.deepEqual(segments('hello', []), [{ text: 'hello', color: null }])
    assert.deepEqual(segments('', [m(0, 3)]), [])
    assert.deepEqual(segments('hello', undefined), [{ text: 'hello', color: null }])
  })
})

describe('what the server does with marks', () => {
  const note = (data) => ({ id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 200, data })
  test('a note keeps valid marks, fits the rest, and refuses a non-list', () => {
    assert.deepEqual(validateItem(note({ text: 'hello world', marks: [m(0, 5, 'green')] })).item.data.marks, [m(0, 5, 'green')])
    assert.deepEqual(validateItem(note({ text: 'hi', marks: [m(0, 99), m(7, 9)] })).item.data.marks, [m(0, 2)], 'clipped to the text')
    assert.equal('marks' in validateItem(note({ text: 'hi', marks: [m(7, 9, 'plaid')] })).item.data, false, 'nothing valid left: no key')
    assert.equal(validateItem(note({ text: 'hi', marks: 'nope' })).ok, false)
    assert.equal(validateItem({ ...note({ text: 'hi', marks: [m(0, 1)] }), kind: 'text' }).item.data.marks?.length, 1, 'other kinds just carry it along untouched')
  })

  const board = { code: 'ABCDEF', lastTs: 0, type: 'workshop' }
  const owner = { uid: 'o', name: 'O', avatar: null, isOwner: true }
  const stored = { id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, data: { text: 'hello world', marks: [m(6, 11, 'pink')] }, boardCode: 'ABCDEF', authorUid: 'o', authorName: 'O', votes: [], reactions: {}, deleted: false, updatedAt: 1 }
  const update = (data) => planOps(board, new Map([['n1', stored]]), [{ op: 'update', id: 'n1', patch: { data } }], owner, 10).applied[0]

  test('a text edit that sends no marks keeps the old ones, clipped to the new text', () => {
    assert.deepEqual(update({ text: 'hello world and more' }).data.marks, [m(6, 11, 'pink')])
    assert.deepEqual(update({ text: 'hello' }).data.marks ?? [], [], 'the marked word is gone, so is the mark')
    assert.deepEqual(update({ text: 'hello wo' }).data.marks, [m(6, 8, 'pink')])
  })
  test('sending marks replaces them, and an empty list removes the key', () => {
    assert.deepEqual(update({ marks: [m(0, 5, 'blue')] }).data.marks, [m(0, 5, 'blue')])
    assert.equal('marks' in update({ marks: [] }).data, false)
  })
})

describe('in the browser', () => {
  const noteItem = (extra = {}) => ({ id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, data: { text: 'hello world', color: 'yellow', ...extra } })
  const render = (item, props = {}) => renderToStaticMarkup(createElement(ItemView, { item, selected: false, editable: true, onChange() {}, onSelect() {}, label: 'x', ...props }))

  test('a note draws its highlighted words as marks in their colours', () => {
    const html = render(noteItem({ marks: [m(6, 11, 'blue')] }))
    assert.match(html, /hello <mark class="bd-mark bd-mark-blue">world<\/mark>/)
  })
  test('a note with no marks is plain text', () => {
    assert.doesNotMatch(render(noteItem()), /<mark/)
  })
  test('while a note is edited the marks are drawn behind the see-through box, and the box is still the one thing to type in', () => {
    const html = render(noteItem({ marks: [m(0, 5, 'green')] }), { autoEdit: true })
    assert.match(html, /bd-editor-back[^>]*aria-hidden="true"[^>]*><mark class="bd-mark bd-mark-green">hello<\/mark> world/)
    assert.equal((html.match(/<textarea/g) ?? []).length, 1)
  })
  test('a text box or a frame has no highlight machinery', () => {
    const html = render({ id: 't', kind: 'text', x: 0, y: 0, w: 200, h: 50, z: 0, rot: 0, data: { text: 'plain' } }, { autoEdit: true })
    assert.doesNotMatch(html, /bd-editor-back|bd-markbar/)
  })

  test('undoing the first highlight of a note takes it away again (and redo puts it back)', () => {
    let s = initialState({ board: { code: 'ABC234' }, items: [{ ...noteItem(), deleted: false, updatedAt: 1 }], people: [] })
    s = reducer(s, { type: 'local', ops: [{ op: 'update', id: 'n1', patch: { data: { text: 'hello world', marks: [m(0, 5, 'pink')] } } }] })
    assert.deepEqual(s.items.get('n1').data.marks, [m(0, 5, 'pink')])
    const back = undo(s)
    assert.deepEqual(back.state.items.get('n1').data.marks, [])
  })
})
