// The column model shared by the New-board dialog, the starter layout, the server and the settings panel. Pure and
// browser-safe. A column is { title, emoji? }; on a board it is a frame item whose data is { title, col: true }, with
// the emoji written in front of the title text (so the canvas needs no special rendering and old boards need no migration).
import { isSingleEmoji } from './emoji.js'

export const MAX_COLUMNS = 8
export const MAX_COLUMN_TITLE = 40
export const MAX_HEADER = 120
export const DEFAULT_HEADER = 'Add notes to each column, then vote.'

// Titles of the built-in layouts. templates.js builds its retro/workshop starters from these, so the dialog's "Reset to
// template" always matches what an untouched template creates. A leading emoji is split off by columnsFromTitles.
export const PRESET_TITLES = {
  'retro-wwci': ['✅ Went Well', '⚠️ Could Be Improved', '🚧 Blockers', '💡 Ideas'],
  'retro-ssc': ['Start', 'Stop', 'Continue'],
  'retro-msg': ['Mad', 'Sad', 'Glad'],
  retro: ['Went well', 'To improve', 'Action items'],
  brainstorm: ['Ideas', 'Questions', 'Next steps'],
  swot: ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'],
  blank: ['Column 1', 'Column 2', 'Column 3'],
}

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const firstGrapheme = (s) => {
  if (segmenter) { for (const { segment } of segmenter.segment(s)) return segment; return '' }
  return Array.from(s)[0] ?? ''
}

// Control, bidi-override/isolate and zero-width characters go; whitespace collapses. (ZWJ inside an emoji is validated
// separately by isSingleEmoji and never goes through here.)
// eslint-disable-next-line no-control-regex
const UNWANTED = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\u061c\ufeff]/g
export const cleanColumnTitle = (s) => s.replace(UNWANTED, ' ').replace(/\s+/g, ' ').trim()

// '✅ Went Well' -> { emoji: '✅', title: 'Went Well' }; 'Start' -> { emoji: '', title: 'Start' }
export function splitTitle(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  const g = firstGrapheme(s)
  if (g && isSingleEmoji(g)) {
    const rest = s.slice(g.length)
    if (!rest || /^\s/.test(rest)) return { emoji: g, title: rest.trim() }
  }
  return { emoji: '', title: s }
}

export const joinTitle = ({ title, emoji }) => (emoji ? `${emoji} ${title}`.trim() : title)

export const columnsFromTitles = (titles) => titles.map(splitTitle)

// Preset columns for a built-in template key (see PRESET_TITLES); unknown keys give the blank three.
export function presetColumns(templateKey) {
  const titles = Object.hasOwn(PRESET_TITLES, templateKey) ? PRESET_TITLES[templateKey] : PRESET_TITLES.blank
  return columnsFromTitles(titles)
}

const err = (error) => ({ ok: false, error })

// -> { ok: true, columns: [{ title, emoji }] } | { ok: false, error }. Only title and emoji are kept.
export function validateColumns(input) {
  if (!Array.isArray(input) || input.length < 1) return err('add at least one column')
  if (input.length > MAX_COLUMNS) return err(`at most ${MAX_COLUMNS} columns`)
  const columns = []
  for (const c of input) {
    if (c === null || typeof c !== 'object' || Array.isArray(c) || typeof c.title !== 'string') return err('each column needs a title')
    const title = cleanColumnTitle(c.title)
    if (!title) return err('column titles cannot be empty')
    if (Array.from(title).length > MAX_COLUMN_TITLE) return err(`column titles can be up to ${MAX_COLUMN_TITLE} characters`)
    const emoji = c.emoji ?? ''
    if (typeof emoji !== 'string') return err('a column emoji must be one emoji')
    if (emoji !== '' && !isSingleEmoji(emoji)) return err('a column emoji must be exactly one emoji')
    columns.push({ title, emoji })
  }
  return { ok: true, columns }
}

export function validateHeader(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: DEFAULT_HEADER }
  if (typeof raw !== 'string') return err('header must be text')
  const value = cleanColumnTitle(raw)
  if (!value) return { ok: true, value: DEFAULT_HEADER }
  if (Array.from(value).length > MAX_HEADER) return err(`header can be up to ${MAX_HEADER} characters`)
  return { ok: true, value }
}

// Frame items for the columns, left to right. Ids are starter-col-<n>.
export function layoutColumns(columns, { w = 360, h = 640, gap = 24, top = 140 } = {}) {
  return columns.map((c, i) => ({ id: `starter-col-${i + 1}`, kind: 'frame', x: i * (w + gap), y: top, w, h, z: 0, rot: 0, data: { title: joinTitle(c), col: true } }))
}

// Where a column added later goes: right of the last one, same size and row (or at the origin when there is none).
export function nextColumnRect(frames, { w = 360, h = 640, gap = 24, top = 140 } = {}) {
  const last = [...frames].sort((a, b) => a.x - b.x).at(-1)
  return last ? { x: last.x + last.w + gap, y: last.y, w: last.w, h: last.h } : { x: 0, y: top, w, h }
}
