// CSV export of a board (Task 17). Pure. RFC 4180 quoting, a formula-injection defence and control/bidi stripping.
import { categorizeRaw, actionLine } from './ai/input.js'
import { ANON_NAME } from './anon.js'

export const BOM = '\uFEFF'
// C0/C1 controls (except tab, LF, CR which are handled below), line/paragraph separators, zero-width and bidi marks.
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g
const FORMULA = /^[=+\-@\t\r]/

// One cell: control/bidi characters removed, a leading = + - @ tab or CR defused with a quote, and RFC 4180 quoting
// when the value holds a comma, quote or line break. (A leading quote is how spreadsheets are told "this is text".)
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value)
  s = s.replace(STRIP, '')
  if (FORMULA.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvRow = (cells) => cells.map(csvCell).join(',')

// rows: arrays of cells -> text with CRLF line ends, BOM first.
export const toCsv = (rows) => BOM + rows.map(csvRow).join('\r\n') + '\r\n'

const HEADER = ['Board', 'Type', 'Category', 'Item', 'Kind', 'Votes', 'Color', 'Created', 'Author']
const iso = (t) => (Number.isFinite(Number(t)) && Number(t) > 0 ? new Date(Number(t)).toISOString() : '')

// 'Item' cell text of a stored item.
function itemText(it) {
  const d = it.data ?? {}
  if (it.kind === 'shoutout') return `To ${d.toName ?? ''}: ${d.message ?? ''}`
  if (it.kind === 'action') return actionLine(d)
  if (it.kind === 'theme') return d.title ?? ''
  return (it.kind === 'card' ? d.message : d.text) ?? ''
}

// board, items, participants (a single consistent read) -> the CSV text. `authors` adds the Author column with the
// persona NAME only: never a uid, e-mail or user id; an item whose author was removed falls back to its stored authorName.
// Items carry no creation stamp, so `Created` is the item's last write (updatedAt) and the tie-break order uses it too.
export function boardCsv(board, items, participants = [], { authors = false } = {}) {
  const live = (items ?? []).filter((i) => i && !i.deleted)
  const byId = new Map(live.map((i) => [i.id, i]))
  const cat = new Map(categorizeRaw(live).map((r, n) => [r.id, { category: r.category, order: n }]))
  const names = new Map((participants ?? []).map((p) => [p.uid, p.name]))
  const celebration = board.type === 'celebration'
  const rows = []
  for (const [id, c] of cat) {
    const it = byId.get(id)
    const category = it.kind === 'card' && celebration ? 'Cards' : it.kind === 'shoutout' ? String(it.data?.badge ?? 'Shoutout') : c.category
    rows.push({ it, category, order: c.order })
  }
  rows.sort((a, b) => a.order - b.order) // categorizeRaw order is column left-to-right, then top to bottom
  const rank = new Map()
  for (const r of rows) if (!rank.has(r.category)) rank.set(r.category, rank.size)
  rows.sort((a, b) => rank.get(a.category) - rank.get(b.category) || (b.it.votes?.length ?? 0) - (a.it.votes?.length ?? 0) || (a.it.createdAt ?? a.it.updatedAt ?? 0) - (b.it.createdAt ?? b.it.updatedAt ?? 0) || a.order - b.order)
  const head = authors ? HEADER : HEADER.slice(0, -1)
  const out = [head]
  const line = (cells, author) => out.push(authors ? [...cells, author] : cells)
  for (const { it, category } of rows) {
    line([board.title, board.type, category, itemText(it), it.kind, it.votes?.length ?? 0, it.data?.color ?? '', iso(it.createdAt ?? it.updatedAt)], it.anon === true ? ANON_NAME : (names.get(it.authorUid) ?? it.authorName ?? ''))
  }
  // Only a shared summary is part of the export (a draft is the owner's working copy).
  const summary = board.summary
  if (summary?.status === 'shared' && typeof summary.text === 'string' && summary.text) line([board.title, board.type, 'Summary', summary.text, 'Summary', 0, '', iso(summary.editedAt ?? summary.generatedAt)], '')
  return toCsv(out)
}
