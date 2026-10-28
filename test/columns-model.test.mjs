import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_COLUMNS, validateColumns, validateHeader, layoutColumns, presetColumns, splitTitle, joinTitle, nextColumnRect, DEFAULT_HEADER, PRESET_TITLES } from '../src/lib/columns.js'
import { getTemplate } from '../src/lib/templates.js'
import { validateBoardInput, validateItem } from '../src/lib/validate.js'

const ch = (...cps) => String.fromCodePoint(...cps)
const ZWJ = ch(0x200d)
const family = ['👨', '👩', '👧'].join(ZWJ)

test('validateColumns: 1 to 8 columns, titles trimmed and cleaned, emoji optional', () => {
  const r = validateColumns([{ title: '  Went   well ', emoji: '✅' }, { title: 'Next' }])
  assert.deepEqual(r, { ok: true, columns: [{ title: 'Went well', emoji: '✅' }, { title: 'Next', emoji: '' }] })
  assert.equal(validateColumns([]).ok, false)
  assert.equal(validateColumns('x').ok, false)
  assert.equal(validateColumns(undefined).ok, false)
  assert.equal(validateColumns(Array.from({ length: MAX_COLUMNS }, (_, i) => ({ title: `c${i}` }))).ok, true)
  assert.equal(validateColumns(Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => ({ title: `c${i}` }))).ok, false)
})

test('validateColumns: duplicate titles are allowed, empty or non-string titles are not', () => {
  assert.equal(validateColumns([{ title: 'A' }, { title: 'A' }]).ok, true)
  for (const bad of [{ title: '' }, { title: '   ' }, { title: 5 }, {}, null, 'x', [], { title: ch(0x200b, 0x202e) }]) assert.equal(validateColumns([bad]).ok, false, JSON.stringify(bad))
})

test('validateColumns: 40 characters (not code units), control / bidi / zero-width stripped', () => {
  assert.equal(validateColumns([{ title: 'a'.repeat(40) }]).ok, true)
  assert.equal(validateColumns([{ title: 'a'.repeat(41) }]).ok, false)
  assert.equal(validateColumns([{ title: '🎉'.repeat(40) }]).ok, true)
  assert.equal(validateColumns([{ title: '🎉'.repeat(41) }]).ok, false)
  const dirty = `Go${ch(0x202e)}od${ch(0x200b)}${ch(0x2066)}\n\tday${ch(0xfeff)}`
  assert.equal(validateColumns([{ title: dirty }]).columns[0].title, 'Go od day')
  assert.equal(validateColumns([{ title: `a${ch(0x200b)}b` }]).columns[0].title, 'a b')
})

test('validateColumns: emoji must be exactly one emoji or empty', () => {
  for (const ok of ['✅', '⚠️', '👍🏽', '🇵🇹', family, '1️⃣', '']) assert.equal(validateColumns([{ title: 'a', emoji: ok }]).ok, true, ok)
  for (const bad of ['ab', 'a', '🎉🎉', '✅ ', family + '👦👦', ZWJ, ch(0x202e), 5, {}, ch(0x1f34c, 0x200d, 0x1f34c)]) assert.equal(validateColumns([{ title: 'a', emoji: bad }]).ok, false, String(bad))
})

test('validateColumns keeps only title and emoji', () => {
  const r = validateColumns([{ title: 'a', emoji: '', x: 5, data: { col: false }, __proto__: { y: 1 } }])
  assert.deepEqual(r.columns, [{ title: 'a', emoji: '' }])
})

test('validateHeader: default when absent or blank, cleaned, limited', () => {
  assert.equal(validateHeader().value, DEFAULT_HEADER)
  assert.equal(validateHeader('   ').value, DEFAULT_HEADER)
  assert.equal(validateHeader(' Hello\nteam ').value, 'Hello team')
  assert.equal(validateHeader('a'.repeat(120)).ok, true)
  assert.equal(validateHeader('a'.repeat(121)).ok, false)
  assert.equal(validateHeader(5).ok, false)
})

test('splitTitle / joinTitle round-trip an emoji prefix', () => {
  assert.deepEqual(splitTitle('✅ Went Well'), { emoji: '✅', title: 'Went Well' })
  assert.deepEqual(splitTitle('⚠️ Could Be Improved'), { emoji: '⚠️', title: 'Could Be Improved' })
  assert.deepEqual(splitTitle('Start'), { emoji: '', title: 'Start' })
  assert.deepEqual(splitTitle('🎉'), { emoji: '🎉', title: '' })
  assert.deepEqual(splitTitle('1st go'), { emoji: '', title: '1st go' })
  assert.equal(joinTitle({ emoji: '✅', title: 'Went Well' }), '✅ Went Well')
  assert.equal(joinTitle({ emoji: '', title: 'Start' }), 'Start')
})

test('layoutColumns: 1 to 8 columns, ids starter-col-n, flagged as columns, never overlapping, inside the item limits', () => {
  for (let n = 1; n <= MAX_COLUMNS; n++) {
    const cols = Array.from({ length: n }, (_, i) => ({ title: `T${i}`, emoji: i % 2 ? '🎉' : '' }))
    const frames = layoutColumns(cols)
    assert.equal(frames.length, n)
    frames.forEach((f, i) => {
      assert.equal(f.id, `starter-col-${i + 1}`)
      assert.equal(f.kind, 'frame')
      assert.equal(f.data.col, true)
      assert.equal(f.data.title, i % 2 ? `🎉 T${i}` : `T${i}`)
      assert.deepEqual([f.w, f.h, f.y, f.x], [360, 640, 140, i * 384])
      assert.equal(validateItem(f).ok, true)
      if (i) assert.equal(f.x - (frames[i - 1].x + frames[i - 1].w), 24)
    })
  }
  assert.deepEqual(layoutColumns([{ title: 'a' }], { w: 100, h: 50, gap: 10, top: 0 })[0], { id: 'starter-col-1', kind: 'frame', x: 0, y: 0, w: 100, h: 50, z: 0, rot: 0, data: { title: 'a', col: true } })
})

test('nextColumnRect: right of the right-most column with the same size, or the origin', () => {
  const frames = [{ x: 400, y: 140, w: 300, h: 500 }, { x: 0, y: 140, w: 360, h: 640 }]
  assert.deepEqual(nextColumnRect(frames), { x: 724, y: 140, w: 300, h: 500 })
  assert.deepEqual(nextColumnRect([]), { x: 0, y: 140, w: 360, h: 640 })
})

test('presetColumns: the built-in retro layouts, the blank three, unknown keys fall back to blank', () => {
  assert.deepEqual(presetColumns('retro-ssc'), [{ emoji: '', title: 'Start' }, { emoji: '', title: 'Stop' }, { emoji: '', title: 'Continue' }])
  assert.equal(presetColumns('retro-wwci')[0].emoji, '✅')
  assert.equal(presetColumns('blank').length, 3)
  assert.deepEqual(presetColumns('nope'), presetColumns('blank'))
  assert.deepEqual(presetColumns('__proto__'), presetColumns('blank'))
  for (const k of Object.keys(PRESET_TITLES)) assert.equal(validateColumns(presetColumns(k)).ok, true, k)
})

test('templates: retro starters honour columns and header; the default is unchanged and its frames are columns', () => {
  const t = getTemplate('retro', 'retro-ssc')
  const def = t.starterItems()
  assert.deepEqual(def.filter((i) => i.kind === 'frame').map((f) => f.data), [{ title: 'Start', col: true }, { title: 'Stop', col: true }, { title: 'Continue', col: true }])
  const cols = [{ title: 'Keep', emoji: '🔥' }, { title: 'Drop', emoji: '' }]
  const items = t.starterItems(undefined, { columns: cols, header: 'Be kind.' })
  assert.deepEqual(items.map((i) => i.id), ['starter-header', 'starter-col-1', 'starter-col-2'])
  assert.equal(items[0].data.text, 'Be kind.')
  assert.equal(items[0].w, 2 * 384 - 24)
  assert.equal(items[1].data.title, '🔥 Keep')
  assert.equal(t.columns.length, 3)
})

test('templates: workshop templates with frames take custom columns, blank and celebrations ignore them', () => {
  const retro = getTemplate('workshop', 'retro')
  assert.ok(retro.columns)
  const items = retro.starterItems(undefined, { columns: [{ title: 'A' }, { title: 'B' }] })
  assert.deepEqual(items.map((i) => [i.id, i.x, i.y, i.h]), [['starter-col-1', 0, 0, 520], ['starter-col-2', 400, 0, 520]])
  assert.equal(retro.starterItems().length, 3, 'the built-in frames are untouched')
  assert.equal(getTemplate('workshop', 'blank').columns, null)
  assert.equal(getTemplate('workshop', 'blank').starterItems(undefined, { columns: [{ title: 'A' }] }).length, 0)
  assert.equal(getTemplate('celebration', 'birthday').columns, undefined)
})

test('validateBoardInput: columns and header accepted for retro and column workshop templates, ignored elsewhere, bad ones rejected', () => {
  const cols = [{ title: 'A', emoji: '🎉' }]
  const r = validateBoardInput({ type: 'retro', template: 'retro-msg', title: 'T', columns: cols, header: ' Go ' })
  assert.deepEqual(r.board.columns, [{ title: 'A', emoji: '🎉' }])
  assert.equal(r.board.header, 'Go')
  assert.equal(validateBoardInput({ type: 'retro', template: 'retro-msg', title: 'T' }).board.columns, undefined)
  const w = validateBoardInput({ type: 'workshop', template: 'swot', title: 'T', columns: cols, header: 'x' })
  assert.deepEqual([w.board.columns.length, w.board.header], [1, undefined])
  for (const [type, template] of [['workshop', 'blank'], ['celebration', 'birthday'], ['wall', 'team']]) {
    const x = validateBoardInput({ type, template, title: 'T', recipient: { name: 'Sam' }, columns: [{ title: '' }], header: 5 })
    assert.equal(x.ok, true, template)
    assert.equal(x.board.columns, undefined)
  }
  assert.equal(validateBoardInput({ type: 'retro', template: 'retro-msg', title: 'T', columns: [] }).ok, false)
  assert.equal(validateBoardInput({ type: 'retro', template: 'retro-msg', title: 'T', columns: 'x' }).ok, false)
  assert.equal(validateBoardInput({ type: 'retro', template: 'retro-msg', title: 'T', columns: cols, header: 'a'.repeat(121) }).ok, false)
})
