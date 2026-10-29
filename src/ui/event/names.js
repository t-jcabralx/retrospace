// Names from a pasted list or a file: one per line, or a CSV (a header such as "Name" is skipped; with several columns the
// Name column, or else the first, is used; a single row of several cells is read as a list of names). Pure.
const HEADERS = new Set(['name', 'names', 'participant', 'participants', 'full name', 'fullname', 'employee', 'person', 'attendee'])

function cells(src, delim) {
  const rows = []
  let row = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

export function namesFromCsv(text, { max = 2000 } = {}) {
  const src = String(text ?? '').replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0]
  const rows = cells(src, delim[1] > 1 ? delim[0] : ',')
  if (!rows.length) return []
  const head = rows[0].map((c) => c.trim().toLowerCase())
  const named = head.findIndex((h) => HEADERS.has(h))
  let out
  if (named >= 0) out = rows.slice(1).map((r) => r[named] ?? '')
  else if (rows.length === 1 && rows[0].length > 1) out = rows[0]
  else out = rows.map((r) => r[0] ?? '')
  return out.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max)
}
