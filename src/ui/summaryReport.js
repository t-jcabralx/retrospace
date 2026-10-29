// Pure helpers behind the summary report. The AI's text is untrusted: parseSummary turns it into plain strings only (never
// markup), and everything downstream renders those strings as React text. The two tables are built from the board's own
// items (text, votes, action fields), never from the AI text and never from author fields.
import { categorizeRaw } from '../lib/ai/input.js'

export const MAX_SECTIONS = 100
export const MAX_ITEMS = 60
export const MAX_ITEM_CHARS = 400
const MAX_PARAS = 60
const MAX_PARA_CHARS = 1200
const MAX_INPUT = 20000

const KNOWN = 'what went well|what to improve|what could improve|blockers?|ideas?|key takeaways?|takeaways?|headlines?|open questions?|actions?|action items|summary|next steps'
const KNOWN_HEAD = new RegExp(`^(${KNOWN})\\s*:?\\s*$`, 'i')
const KNOWN_INLINE = new RegExp(`^(${KNOWN})\\s*:\\s*(\\S.*)$`, 'i')
const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.*)$/
const UNDERLINE = /^\s*(?:-{3,}|={3,})\s*$/

// Emphasis and code marks go; what is left is plain text.
function clean(s, max) {
  const t = String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\*\*([^*]*)\*\*/g, '$1').replace(/__([^_]*)__/g, '$1').replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1$2')
    .replace(/`+/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return Array.from(t).length > max ? `${Array.from(t).slice(0, max - 1).join('')}…` : t
}

const heading = (raw) => {
  const m = /^#{1,6}\s+(.+?)\s*#*$/.exec(raw) ?? /^\*\*([^*]+)\*\*\s*:?$/.exec(raw) ?? /^__([^_]+)__\s*:?$/.exec(raw)
  return m ? clean(m[1], 80).replace(/:$/, '').trim() : null
}

// text -> { sections: [{ title, items, paragraphs }], preamble: string[] }
export function parseSummary(text) {
  const lines = String(text ?? '').slice(0, MAX_INPUT).split(/\r\n|\r|\n/)
  const sections = []
  const preamble = []
  let cur = null
  let item = null // the open bullet that a wrapped line is joined to
  const open = (title) => {
    item = null
    if (sections.length >= MAX_SECTIONS) { cur = sections[sections.length - 1]; return }
    cur = { title: title || 'Notes', items: [], paragraphs: [] }
    sections.push(cur)
  }
  const para = (t) => {
    const list = cur ? cur.paragraphs : preamble
    if (list.length < MAX_PARAS) list.push(clean(t, MAX_PARA_CHARS))
  }
  const bullet = (t) => {
    if (!cur) open('Notes')
    if (cur.items.length >= MAX_ITEMS) { item = null; return }
    cur.items.push(clean(t, MAX_ITEM_CHARS))
    item = cur.items.length - 1
  }

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n].trim()
    if (!raw) { item = null; continue }
    if (UNDERLINE.test(raw)) continue
    const next = (lines[n + 1] ?? '').trim()
    const md = heading(raw)
    if (md) { open(md); continue }
    const b = BULLET.exec(lines[n])
    if (b) { if (clean(b[1], 5)) bullet(b[1]); continue }
    const plain = clean(raw, 400)
    if (!plain) continue
    if (UNDERLINE.test(next) && plain.length <= 80) { open(plain.replace(/:$/, '')); continue }
    if (KNOWN_HEAD.test(plain)) { open(plain.replace(/\s*:$/, '')); continue }
    const inline = KNOWN_INLINE.exec(plain)
    if (inline) { open(inline[1]); para(inline[2]); continue }
    if (/^[^:]{1,60}:$/.test(plain) && !/[.!?]:$/.test(plain)) { open(plain.slice(0, -1)); continue }
    if (item !== null && cur && /^\s/.test(lines[n])) {
      const joined = `${cur.items[item]} ${plain}`
      cur.items[item] = Array.from(joined).length > MAX_ITEM_CHARS ? `${Array.from(joined).slice(0, MAX_ITEM_CHARS - 1).join('')}…` : joined
      continue
    }
    para(plain)
  }
  return { sections, preamble }
}

const STYLES = [
  [/went well|success|positive|glad|continue|kudos|win/i, { icon: '✅', tone: 'good' }],
  [/block|depend|impediment/i, { icon: '🚧', tone: 'block' }],
  [/improve|could|problem|issue|risk|mad|sad|stop|challeng/i, { icon: '⚠️', tone: 'warn' }],
  [/idea|suggest|start|propos/i, { icon: '💡', tone: 'idea' }],
  [/takeaway|key|summary|highlight/i, { icon: '⭐', tone: 'key' }],
  [/action|next step|todo|to-do/i, { icon: '🎯', tone: 'idea' }],
  [/question|unknown|unclear/i, { icon: '❓', tone: 'neutral' }],
]
export const sectionStyle = (title) => (STYLES.find(([re]) => re.test(String(title ?? ''))) ?? [0, { icon: '📝', tone: 'neutral' }])[1]
export const isKeySection = (title) => /takeaway|^key\b/i.test(String(title ?? ''))

const flat = (s, max) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const VOTE_KINDS = new Set(['note', 'text', 'shape', 'image', 'card', 'theme'])
const KIND_WORD = { image: 'Image', shape: 'Shape', card: 'Card', theme: 'Theme' }
function voteText(it) {
  const d = it.data ?? {}
  const t = it.kind === 'card' ? d.message : it.kind === 'theme' ? d.title : d.text ?? (it.kind === 'image' ? d.alt : '')
  return flat(typeof t === 'string' ? t : '', 90) || KIND_WORD[it.kind] || 'Untitled'
}

// -> [{ rank, text, votes, category, tied }] most voted first; ties share a rank (1, 1, 3), then by text.
export function votesTable(items, { max = 8 } = {}) {
  const live = (items ?? []).filter((i) => i && !i.deleted && VOTE_KINDS.has(i.kind) && Array.isArray(i.votes) && i.votes.length > 0)
  const cat = new Map(categorizeRaw(items ?? []).map((r) => [r.id, r.category]))
  const rows = live.map((i) => ({ text: voteText(i), votes: i.votes.length, category: i.kind === 'theme' ? 'Themes' : cat.get(i.id) ?? '' }))
    .sort((a, b) => b.votes - a.votes || a.text.localeCompare(b.text))
  let rank = 0
  rows.forEach((r, n) => { if (n === 0 || r.votes !== rows[n - 1].votes) rank = n + 1; r.rank = rank })
  const out = rows.map((r) => ({ rank: r.rank, text: r.text, votes: r.votes, category: r.category, tied: rows.filter((x) => x.rank === r.rank).length > 1 }))
  return out.slice(0, Math.max(0, max))
}

const STATUS = { open: 'Open', doing: 'In progress', done: 'Done' }
const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High' }
const S_ORDER = { open: 0, doing: 1, done: 2 }
const P_ORDER = { high: 0, normal: 1, low: 2 }

// -> [{ action, owner, due, status, priority, flags }] open first, then doing, done; high priority first inside a status.
export function actionsTable(items, { max = 50 } = {}) {
  return (items ?? []).filter((i) => i && !i.deleted && i.kind === 'action')
    .map((i) => {
      const d = i.data ?? {}
      const status = S_ORDER[d.status] === undefined ? 'open' : d.status
      const priority = P_ORDER[d.priority] === undefined ? 'normal' : d.priority
      const owner = flat(d.owner, 60)
      const due = flat(d.due, 30)
      return { key: [S_ORDER[status], P_ORDER[priority]], action: flat(d.action, 200) || 'Untitled action', owner, due, status: STATUS[status], priority: PRIORITY[priority], flags: [!owner && 'Needs owner', !due && 'Needs due date'].filter(Boolean) }
    })
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.action.localeCompare(b.action))
    .slice(0, max)
    .map(({ key, ...row }) => row) // eslint-disable-line no-unused-vars
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const cell = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim()

// The "Copy as table" payload: one semantic <table> per block (sections, most voted, actions) and the same as tab-separated text.
export function clipboardTables({ sections = [], preamble = [], votes = [], actions = [] } = {}) {
  const blocks = []
  const pts = [...preamble.map((p) => ['Summary', p])]
  for (const s of sections) {
    for (const p of s.paragraphs) pts.push([s.title, p])
    for (const i of s.items) pts.push([s.title, i])
  }
  if (pts.length) blocks.push({ caption: 'Summary', head: ['Section', 'Point'], rows: pts })
  if (votes.length) blocks.push({ caption: 'Most voted', head: ['Rank', 'Item', 'Votes', 'Column'], rows: votes.map((v) => [v.rank, v.text, v.votes, v.category]) })
  if (actions.length) blocks.push({ caption: 'Action items', head: ['Action', 'Owner', 'Due', 'Status', 'Priority'], rows: actions.map((a) => [a.action, a.owner || 'Needs owner', a.due || 'Needs due date', a.status, a.priority]) })
  const html = blocks.map((b) => `<table border="1" cellpadding="4" cellspacing="0"><caption>${escapeHtml(b.caption)}</caption><thead><tr>${b.head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('<br>')
  const text = blocks.map((b) => [b.caption, b.head.map(cell).join('\t'), ...b.rows.map((r) => r.map(cell).join('\t'))].join('\n')).join('\n\n')
  return { html, text }
}
