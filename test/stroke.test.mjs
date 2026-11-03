import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { simplify, buildStroke, checkStrokeData, strokePath, MAX_POINTS, MIN_BOX, COORD_MAX } from '../src/lib/stroke.js'
import { validateItem, validateOp, NOTE_COLORS } from '../src/lib/validate.js'
import { planOps } from '../src/lib/plan.js'
import { defaultRetro, STAGE_KEYS } from '../src/lib/retro.js'
import { toolAllowed } from '../src/lib/clientRules.js'
import { isVotable } from '../src/lib/vote.js'
import { isHighlightable } from '../src/lib/highlight.js'
import { categorizeRaw } from '../src/lib/ai/input.js'
import { buildPrintModel } from '../src/lib/printModel.js'
import { boardCsv } from '../src/lib/csv.js'
import { initialState, reducer, undo } from '../src/client/state.js'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: ItemView } = await import('../src/ui/ItemView.jsx')

const pts = (...xy) => xy.map(([x, y]) => ({ x, y }))
const good = () => buildStroke(pts([10, 10], [60, 20], [120, 70]))
const item = (extra = {}) => ({ id: 's1', kind: 'stroke', x: 1, y: 1, w: 100, h: 60, z: 1, rot: 0, data: good().data, ...extra })

describe('the stroke maths', () => {
  test('simplify drops points that are too close, always keeps the end, and caps the count', () => {
    assert.deepEqual(simplify(pts([0, 0], [1, 0], [2, 0], [10, 0])).map((p) => p.x), [0, 10])
    assert.deepEqual(simplify(pts([0, 0], [20, 0], [21, 0])).map((p) => p.x), [0, 20, 21], 'the last point stays')
    const long = Array.from({ length: 2000 }, (_, i) => ({ x: i * 5, y: 0 }))
    const out = simplify(long)
    assert.equal(out.length, MAX_POINTS)
    assert.deepEqual([out[0], out.at(-1)], [long[0], long.at(-1)])
  })

  test('buildStroke makes a padded box and whole-number points inside 0..1000', () => {
    const s = good()
    assert.deepEqual(s.rect, { x: 1, y: 1, w: 128, h: 78 }) // the scribble grown by half the 18px pen
    assert.equal(s.data.color, 'yellow')
    assert.equal(s.data.width, 18)
    assert.ok(s.data.pts.length % 2 === 0 && s.data.pts.every((n) => Number.isInteger(n) && n >= 0 && n <= COORD_MAX))
    assert.equal(checkStrokeData(s.data, NOTE_COLORS), null)
  })

  test('a tap is nothing, and a flat line still gets a box thick enough to pick', () => {
    assert.equal(buildStroke(pts([5, 5])), null)
    assert.equal(buildStroke([]), null)
    const flat = buildStroke(pts([0, 0], [100, 0]), { width: 4 })
    assert.ok(flat.rect.h >= MIN_BOX)
  })

  test('strokePath turns the numbers into an SVG path, and an empty one into nothing', () => {
    assert.equal(strokePath([1, 2, 3, 4, 5, 6]), 'M1 2L3 4L5 6')
    assert.equal(strokePath([1, 2]), '')
    assert.equal(strokePath(undefined), '')
  })
})

describe('what the server accepts', () => {
  test('a good stroke is a valid item, and the checks refuse the rest', () => {
    assert.equal(validateItem(item()).ok, true)
    const bad = (data) => validateItem(item({ data })).ok
    const d = good().data
    assert.equal(bad({ ...d, pts: [1, 2, 3] }), false, 'odd count')
    assert.equal(bad({ ...d, pts: [1, 2] }), false, 'one point')
    assert.equal(bad({ ...d, pts: Array(MAX_POINTS * 2 + 2).fill(5) }), false, 'too many')
    assert.equal(bad({ ...d, pts: [0, 0, 1001, 5] }), false, 'out of range')
    assert.equal(bad({ ...d, pts: [0, 0, 1.5, 5] }), false, 'not whole')
    assert.equal(bad({ ...d, pts: 'nope' }), false)
    assert.equal(bad({ ...d, color: 'plaid' }), false)
    assert.equal(bad({ ...d, width: 99 }), false)
    assert.equal(bad({ ...d, width: 12 }), true)
    assert.equal(validateOp({ op: 'add', item: item() }).ok, true)
  })

  const owner = { uid: 'o', name: 'O', avatar: null, isOwner: true }
  const ann = { uid: 'a', name: 'A', avatar: null, isOwner: false }
  const add = (board, actor, it = item()) => planOps(board, new Map(), [{ op: 'add', id: it.id, item: it }], actor, 10)

  test('boards that draw take strokes; the wall and the wheel do not', () => {
    for (const type of ['workshop', 'retro', 'celebration']) assert.equal(add({ code: 'ABCDEF', lastTs: 0, type }, ann).rejected.length, 0, type)
    assert.equal(add({ code: 'ABCDEF', lastTs: 0, type: 'wall' }, ann).rejected.length, 1)
    assert.equal(add({ code: 'ABCDEF', lastTs: 0, type: 'event' }, ann).rejected.length, 1)
  })

  test('on a retro board a stroke is content: closed for guests once collecting ends, still open to the owner', () => {
    const board = { code: 'ABCDEF', lastTs: 0, type: 'retro', retro: { ...defaultRetro(), current: STAGE_KEYS.indexOf('discuss') } }
    assert.equal(add(board, ann).rejected[0].error, 'This stage is closed for notes')
    assert.equal(add(board, owner).rejected.length, 0)
  })

  test('a stroke cannot be voted for or highlighted', () => {
    assert.equal(isVotable(item()), false)
    assert.equal(isHighlightable(item()), false)
    const stored = { ...item(), boardCode: 'ABCDEF', authorUid: 'a', authorName: 'A', votes: [], reactions: {}, deleted: false, updatedAt: 1 }
    const r = planOps({ code: 'ABCDEF', lastTs: 0, vote: { active: true, perPerson: 3 } }, new Map([['s1', stored]]), [{ op: 'vote', id: 's1' }, { op: 'highlight', id: 's1', on: true }], owner, 10)
    assert.deepEqual(r.rejected.map((x) => x.error), ["Can't vote on this", "Can't highlight this"])
  })

  test('only the pen tool offers it, on the boards that take it', () => {
    assert.equal(toolAllowed('workshop', 'highlighter'), true)
    assert.equal(toolAllowed('retro', 'highlighter'), true)
    assert.equal(toolAllowed('wall', 'highlighter'), false)
    assert.equal(toolAllowed('event', 'highlighter'), false)
  })
})

describe('strokes stay out of the words', () => {
  const note = { id: 'n', kind: 'note', x: 0, y: 0, w: 100, h: 100, data: { text: 'a real note' }, votes: [], deleted: false, updatedAt: 1 }
  test('the AI input, the print document and the CSV rows list notes, never strokes', () => {
    assert.deepEqual(categorizeRaw([note, item()]).map((r) => r.id), ['n'])
    const m = buildPrintModel({ title: 'T', type: 'workshop' }, [note, item()], [])
    assert.deepEqual(m.sections.flatMap((s) => s.items.map((i) => i.id)), ['n'])
    assert.equal(m.highlights, null)
    const rows = boardCsv({ title: 'T', type: 'workshop' }, [note, item()], []).replace('\uFEFF', '').trim().split('\r\n')
    assert.equal(rows.length, 2, 'the header and the one note')
    assert.ok(!rows.join('\n').includes('stroke'))
  })
})

describe('in the browser', () => {
  test('a stroke shows as one path, with its colour, and is not a text item', () => {
    const html = renderToStaticMarkup(createElement(ItemView, { item: item({ data: { ...good().data, color: 'pink' } }), selected: false, editable: true, onChange() {}, onSelect() {}, label: 'x' }))
    assert.match(html, /bd-k-stroke/)
    assert.match(html, /<path d="M\d+ \d+L/)
    assert.match(html, /stroke="var\(--note-pink\)"/)
    assert.match(html, /vector-effect="non-scaling-stroke"/)
    assert.doesNotMatch(html, /<textarea/)
  })

  test('adding a stroke shows at once, and undo takes it away again', () => {
    let s = initialState({ board: { code: 'ABC234' }, items: [], people: [] })
    s = reducer(s, { type: 'local', ops: [{ op: 'add', id: 's1', item: { id: 's1', kind: 'stroke', x: 1, y: 1, w: 100, h: 60, z: 1, rot: 0, data: good().data } }] })
    assert.equal(s.items.get('s1').kind, 'stroke')
    s = undo(s).state
    assert.equal(s.items.size, 0)
  })
})
