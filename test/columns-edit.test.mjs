import test from 'node:test'
import assert from 'node:assert/strict'
import { withKeys, stripKeys, moveRow, reorderRow, updateRow, removeRow, addRow, canAdd, rowProblems, columnsToSend } from '../src/lib/columnsEdit.js'
import { MAX_COLUMNS } from '../src/lib/columns.js'

const rows = () => withKeys([{ title: 'A', emoji: '' }, { title: 'B', emoji: '🔥' }, { title: 'C' }])
const titles = (l) => l.map((r) => r.title).join('')

test('withKeys gives every row a unique key and stripKeys removes it again', () => {
  const r = rows()
  assert.equal(new Set(r.map((x) => x.key)).size, 3)
  assert.deepEqual(stripKeys(r), [{ title: 'A', emoji: '' }, { title: 'B', emoji: '🔥' }, { title: 'C', emoji: '' }])
})

test('moveRow swaps with the neighbour and does nothing at the ends or out of range', () => {
  const r = rows()
  assert.equal(titles(moveRow(r, 0, 1)), 'BAC')
  assert.equal(titles(moveRow(r, 2, -1)), 'ACB')
  assert.equal(moveRow(r, 0, -1), r)
  assert.equal(moveRow(r, 2, 1), r)
  assert.equal(moveRow(r, 9, 1), r)
  assert.equal(titles(r), 'ABC', 'the input is not mutated')
})

test('reorderRow moves a row to an index', () => {
  const r = rows()
  assert.equal(titles(reorderRow(r, 0, 2)), 'BCA')
  assert.equal(titles(reorderRow(r, 2, 0)), 'CAB')
  assert.equal(reorderRow(r, 1, 1), r)
  assert.equal(reorderRow(r, -1, 1), r)
})

test('updateRow patches one row; removeRow keeps at least one; addRow stops at the maximum', () => {
  const r = rows()
  assert.equal(updateRow(r, 1, { title: 'Z' })[1].title, 'Z')
  assert.equal(updateRow(r, 7, { title: 'Z' }), r)
  assert.equal(titles(removeRow(r, 1)), 'AC')
  assert.equal(removeRow(withKeys([{ title: 'only' }]), 0).length, 1)
  let l = r
  while (canAdd(l)) l = addRow(l)
  assert.equal(l.length, MAX_COLUMNS)
  assert.equal(addRow(l), l)
  assert.equal(addRow(r)[3].title, 'Column 4')
})

test('rowProblems / columnsToSend use the server rules', () => {
  assert.equal(rowProblems(rows()), null)
  const bad = updateRow(updateRow(rows(), 0, { title: '  ' }), 2, { emoji: 'ab' })
  const p = rowProblems(bad)
  assert.ok(p[0] && !p[1] && p[2])
  assert.ok(columnsToSend(bad).error)
  assert.deepEqual(columnsToSend(updateRow(rows(), 0, { title: ' x  y ' })).columns[0], { title: 'x y', emoji: '' })
})
