// Pure list edits behind the column editors (New-board dialog, Settings → Columns). A row is { key, title, emoji }; the
// key only identifies the row in the UI and is dropped before anything is sent (stripKeys). Browser-safe.
import { MAX_COLUMNS, validateColumns } from './columns.js'

let counter = 0
export const newKey = () => `col-${Date.now().toString(36)}-${(counter++).toString(36)}`

export const withKeys = (columns) => columns.map((c) => ({ key: newKey(), title: c.title ?? '', emoji: c.emoji ?? '' }))
export const stripKeys = (rows) => rows.map(({ title, emoji }) => ({ title, emoji: emoji || '' }))

export const inRange = (list, i) => Number.isInteger(i) && i >= 0 && i < list.length

// Moves row i by dir (-1 up/left, +1 down/right). Out of range or past an end: the same list.
export function moveRow(list, i, dir) {
  const j = i + dir
  if (!inRange(list, i) || !inRange(list, j)) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// Moves row `from` so it ends up at index `to` (drag and drop).
export function reorderRow(list, from, to) {
  if (!inRange(list, from) || !inRange(list, to) || from === to) return list
  const next = [...list]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row)
  return next
}

export const updateRow = (list, i, patch) => (inRange(list, i) ? list.map((r, k) => (k === i ? { ...r, ...patch } : r)) : list)

// The last column cannot be removed: a board with columns keeps at least one.
export const removeRow = (list, i) => (inRange(list, i) && list.length > 1 ? list.filter((_, k) => k !== i) : list)

export const canAdd = (list) => list.length < MAX_COLUMNS
export const addRow = (list, title = `Column ${list.length + 1}`) => (canAdd(list) ? [...list, ...withKeys([{ title, emoji: '' }])] : list)

// -> one message (or '') per row, in order, using the same rules as the server; null when every row is fine.
export function rowProblems(rows) {
  const out = rows.map((r) => {
    const v = validateColumns([{ title: r.title, emoji: r.emoji }])
    return v.ok ? '' : v.error
  })
  return out.some(Boolean) ? out : null
}

// The cleaned columns to send, or { error } for the first problem.
export function columnsToSend(rows) {
  const v = validateColumns(stripKeys(rows))
  return v.ok ? { columns: v.columns } : { error: v.error }
}
