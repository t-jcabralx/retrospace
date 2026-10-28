// Turns a board's items into the text a summary is written from. Pure; this is the ONLY place that decides what leaves
// the server for the AI provider, and it reads nothing but an item's text and the title of the frame it sits in: never
// an author name, uid, avatar or e-mail, and never a card's signer.
export const MAX_ITEMS = 200
export const MAX_ITEM_CHARS = 300
const UNCATEGORISED = 'Uncategorised'
const TEXT_KINDS = new Set(['note', 'text', 'shape', 'card', 'shoutout', 'action', 'theme'])
// Retro actions and themes sit outside the columns: they have a fixed category, after the last column.
const FIXED = { action: { category: 'Actions', column: 1e9 }, theme: { category: 'Themes', column: 1e9 + 1 } }

// One retro action as a short line: "Fix CI (owner Ann, due 2026-11-01, doing)". Owner and due are free text the team
// typed, like a note's text; nothing here is an author field.
export function actionLine(d = {}) {
  const parts = [d.owner && `owner ${d.owner}`, d.due && `due ${d.due}`, d.status].filter((x) => typeof x === 'string' && x)
  return `${typeof d.action === 'string' ? d.action : ''}${parts.length ? ` (${parts.join(', ')})` : ''}`.trim()
}

// Control characters, line/paragraph separators and invisible bidi/zero-width marks become spaces; runs of whitespace
// collapse, so one item can never fake a heading or a new line of the prompt.
// eslint-disable-next-line no-control-regex
const NOISE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g
// The prompt wraps board text in <board_content> tags; angle brackets in the text are swapped for look-alikes so the
// text cannot close the tag and talk to the model from outside it.
export const flat = (s) => String(s).replace(NOISE, ' ').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim()

function clip(s) {
  const chars = Array.from(s)
  return chars.length > MAX_ITEM_CHARS ? `${chars.slice(0, MAX_ITEM_CHARS - 1).join('')}…` : s
}

const itemText = (it) => {
  const d = it.data ?? {}
  if (it.kind === 'action') return actionLine(d)
  if (it.kind === 'theme') return typeof d.title === 'string' ? d.title : ''
  const raw = it.kind === 'card' || it.kind === 'shoutout' ? d.message : d.text
  return typeof raw === 'string' ? raw : ''
}

// The frame a point sits in. When frames are nested the largest wins: the outer frame is the column, the inner one is
// just a grouping inside it. Equal areas go to the first in reading order (`frames` is sorted).
function frameAt(frames, x, y) {
  let best = null
  for (const f of frames) {
    if (x < f.x || x > f.x + f.w || y < f.y || y > f.y + f.h) continue
    if (!best || f.w * f.h > best.w * best.h) best = f
  }
  return best
}

const byPosition = (a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// -> [{ id, text, category, votes, updatedAt, order }] in a fixed order: columns left to right (then top to bottom),
// items without a column last, and inside a column top to bottom. Deleted items, other kinds and empty texts are skipped.
export function categorizeRaw(items) {
  const live = (items ?? []).filter((i) => i && !i.deleted && Number.isFinite(i.x) && Number.isFinite(i.y))
  const frames = live.filter((i) => i.kind === 'frame' && Number.isFinite(i.w) && Number.isFinite(i.h)).sort(byPosition)
  const rank = new Map(frames.map((f, n) => [f.id, n]))
  const rows = []
  for (const it of live) {
    if (!TEXT_KINDS.has(it.kind) || String(it.id).startsWith('starter-')) continue // starter-* is the template's own header, not feedback
    const text = flat(itemText(it))
    if (!text) continue
    const w = Number.isFinite(it.w) ? it.w : 0
    const h = Number.isFinite(it.h) ? it.h : 0
    const fixed = FIXED[it.kind]
    const frame = fixed ? null : frameAt(frames, it.x + w / 2, it.y + h / 2)
    const title = frame ? flat(frame.data?.title ?? '') : ''
    rows.push({
      id: it.id, text, x: it.x, y: it.y,
      category: fixed ? fixed.category : frame ? title || 'Untitled column' : UNCATEGORISED,
      column: fixed ? fixed.column : frame ? rank.get(frame.id) : Infinity,
      votes: Array.isArray(it.votes) ? it.votes.length : 0,
      updatedAt: Number(it.updatedAt) || 0,
    })
  }
  rows.sort((a, b) => (a.column === b.column ? a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1) : a.column < b.column ? -1 : 1))
  return rows
}

export const categorize = (items) => categorizeRaw(items).map(({ id, text, category }) => ({ id, text, category }))

// kind: 'retro' | 'workshop' | 'celebration'. -> { text, count, truncated: { dropped, trimmed } }.
// Celebration boards send card messages only (flat, no columns, no signers, and no title: it carries the recipient's name).
export function buildSummaryInput(items, { kind = 'workshop', boardTitle = '' } = {}) {
  const celebration = kind === 'celebration'
  let rows = categorizeRaw(celebration ? (items ?? []).filter((i) => i.kind === 'card') : items)
  let trimmed = 0
  rows = rows.map((r) => {
    const text = clip(r.text)
    if (text !== r.text) trimmed++
    return { ...r, text }
  })
  // Over the cap: the least-voted, longest, oldest items go first; the rest keep their order.
  let dropped = 0
  if (rows.length > MAX_ITEMS) {
    const doomed = new Set(
      [...rows]
        .sort((a, b) => a.votes - b.votes || Array.from(b.text).length - Array.from(a.text).length || a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1))
        .slice(0, rows.length - MAX_ITEMS)
        .map((r) => r.id),
    )
    dropped = doomed.size
    rows = rows.filter((r) => !doomed.has(r.id))
  }

  const lines = []
  const title = celebration ? '' : flat(boardTitle)
  if (title) lines.push(`Board title: ${title}`)
  let current = null
  for (const r of rows) {
    if (!celebration && r.category !== current) {
      current = r.category
      lines.push('', `## ${current}`)
    }
    lines.push(`- ${r.text}`)
  }
  const top = rows.filter((r) => r.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 3)
  if (top.length) lines.push('', 'Most-voted:', ...top.map((r) => `- (${r.votes} ${r.votes === 1 ? 'vote' : 'votes'}) ${r.text}`))
  if (dropped || trimmed) {
    const notes = [dropped && `${dropped} of ${rows.length + dropped} items were left out to keep this short`, trimmed && `${trimmed} long items were shortened`].filter(Boolean)
    lines.push('', `Note: ${notes.join('; ')}.`)
  }
  return { text: lines.join('\n').trim(), count: rows.length, truncated: { dropped, trimmed } }
}
