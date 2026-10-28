import test from 'node:test'
import assert from 'node:assert/strict'
import { categorizeRaw, buildSummaryInput, actionLine } from '../src/lib/ai/input.js'
import { boardCsv } from '../src/lib/csv.js'
import { buildPrintModel } from '../src/lib/printModel.js'

const base = { x: 0, y: 0, w: 200, h: 200, z: 0, rot: 0, votes: [], deleted: false, authorUid: 'uid-secret', authorName: 'Brave Otter', authorAvatar: { bg: 1 }, updatedAt: 5 }
const frame = { ...base, id: 'f1', kind: 'frame', w: 400, h: 400, data: { title: 'Went well' } }
const note = { ...base, id: 'n1', kind: 'note', x: 10, y: 10, data: { text: 'Great demo' } }
const action = { ...base, id: 'a1', kind: 'action', x: 10, y: 10, data: { action: 'Fix CI', owner: 'Ann', due: '2026-11-01', status: 'doing', priority: 'normal', measure: '', notes: '' } }
const theme = { ...base, id: 't1', kind: 'theme', x: 10, y: 10, votes: ['v1'], data: { title: 'Tooling', noteIds: ['n1'] } }
const board = { type: 'retro', title: 'Sprint', status: 'open' }
const items = [frame, note, action, theme]

test('actionLine: action plus owner, due and status; tolerant of missing fields', () => {
  assert.equal(actionLine(action.data), 'Fix CI (owner Ann, due 2026-11-01, doing)')
  assert.equal(actionLine({ action: 'Solo' }), 'Solo')
  assert.equal(actionLine(), '')
})

test('categorizeRaw: actions and themes get fixed categories after the columns, even inside a frame', () => {
  const rows = categorizeRaw(items)
  assert.deepEqual(rows.map((r) => [r.id, r.category]), [['n1', 'Went well'], ['a1', 'Actions'], ['t1', 'Themes']])
  assert.equal(rows[1].text, 'Fix CI (owner Ann, due 2026-11-01, doing)')
  assert.equal(rows[2].text, 'Tooling')
})

test('AI input contains actions and themes but no author data', () => {
  const { text, count } = buildSummaryInput(items, { kind: 'retro' })
  assert.equal(count, 3)
  assert.match(text, /## Actions\n- Fix CI \(owner Ann, due 2026-11-01, doing\)/)
  assert.match(text, /## Themes\n- Tooling/)
  for (const secret of ['uid-secret', 'Brave Otter']) assert.ok(!text.includes(secret))
})

test('CSV rows carry actions and themes with their kind', () => {
  const csv = boardCsv(board, items, [])
  const lines = csv.split('\r\n')
  assert.ok(lines.some((l) => l.includes('Actions') && l.includes('"Fix CI (owner Ann, due 2026-11-01, doing)"') && l.includes(',action,')), csv)
  assert.ok(lines.some((l) => l.includes('Themes') && l.includes('Tooling') && l.includes(',theme,')), csv)
})

test('CSV: an anonymous note still reads Anonymous; authors stay off by default', () => {
  const anon = { ...note, id: 'n2', anon: true }
  const withAuthors = boardCsv(board, [frame, anon, action], [{ uid: 'uid-secret', name: 'Brave Otter' }], { authors: true })
  assert.ok(withAuthors.split('\r\n').some((l) => l.includes('Great demo') && l.endsWith('Anonymous')))
  assert.ok(!boardCsv(board, [frame, anon, action], []).includes('Brave Otter'))
})

test('print model: an Actions section, themes kept in their own list', () => {
  const m = buildPrintModel(board, items, [])
  const actions = m.sections.find((s) => s.title === 'Actions')
  assert.deepEqual(actions.items.map((i) => [i.kind, i.text]), [['action', 'Fix CI (owner Ann, due 2026-11-01, doing)']])
  assert.equal(m.sections.some((s) => s.title === 'Themes'), false)
  assert.equal(m.themes.length, 1)
  assert.equal(m.empty, false)
})
