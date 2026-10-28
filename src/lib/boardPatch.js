// Server-only: validation of the settings an owner may change with PATCH /api/boards/[code].
import { BOARD_TEMPLATES } from './templates.js'
import { validateTitle, validateRecipient } from './validate.js'
import { hashPassword } from './password.js'
import { isSingleEmoji } from './emoji.js'
import { ANON_MODES } from './anon.js'
import { aiOf, cleanSummaryText, MAX_SUMMARY } from './aiBoard.js'
import { applyRetroAction, retroEffects, RetroError, RETRO_ACTION_KEYS } from './retro.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'

const themes = Object.values(BOARD_TEMPLATES).flatMap((g) => Object.values(g).map((t) => t.theme))
const PATTERNS = new Set(themes.map((t) => t.pattern))
const EFFECTS = new Set(themes.map((t) => t.effect))
const COLOR = /^#[0-9a-f]{3,8}$/i
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
const MIN_PASSCODE = 4
const MAX_PASSCODE = 64
const MIN_TIMER_MS = 10_000
const MAX_TIMER_MS = 4 * 60 * 60_000
const TIMER_LATE_MS = 5_000 // endsAt may be a few seconds in the past (a slow request)
const TIMER_EARLY_MS = 60_000 // ...and at most a minute beyond now + durationMs (the "+1 min" extension adds a minute to both)
const MAX_THROW_EMOJIS = 12
const AI_KEYS = ['enabled', 'autoSummary', 'autoShare', 'ack']

// Date.parse rolls "2030-02-31" over to March; a day, hour or minute that does not exist is refused instead.
function realCalendarTime(v) {
  const [y, m, d, hh, mm] = v.match(/\d+/g).map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && hh <= 23 && mm <= 59
}

// Each rule returns { value } or { error } (or a promise of one); `key` renames the stored field.
const adapt = (r) => (r.ok ? { value: r.value } : { error: r.error })
const RULES = {
  title: (v) => adapt(validateTitle(v)),
  theme(v) {
    const ok = isObj(v) && COLOR.test(v.bg) && COLOR.test(v.accent) && PATTERNS.has(v.pattern) && EFFECTS.has(v.effect)
    return ok ? { value: { bg: v.bg, pattern: v.pattern, accent: v.accent, effect: v.effect } } : { error: 'invalid theme' }
  },
  locked: (v) => (typeof v === 'boolean' ? { value: v } : { error: 'locked must be a boolean' }),
  // An ISO 8601 date-time (with a zone) or null. Past times are fine ("Reveal now" is one); Date.parse alone would accept
  // junk such as "1" or "tomorrow 5", so the shape is checked first and the year kept to a sane range.
  revealAt(v) {
    if (v === null) return { value: null }
    const d = isStr(v) && ISO_DATETIME.test(v) && realCalendarTime(v) ? new Date(v) : null
    const ok = d && !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100
    return ok ? { value: d } : { error: 'revealAt must be an ISO date-time or null' }
  },
  recipient: (v) => adapt(validateRecipient(v)),
  vote(v) {
    const ok = isObj(v) && typeof v.active === 'boolean' && Number.isInteger(v.perPerson) && v.perPerson >= 1 && v.perPerson <= 20
    return ok ? { value: { active: v.active, perPerson: v.perPerson } } : { error: 'invalid vote' }
  },
  // { endsAt: ms epoch on the SERVER clock, durationMs }: every client counts down to endsAt (see ui/timer.js). null stops it.
  timer(v) {
    if (v === null) return { value: null }
    const num = (n) => typeof n === 'number' && Number.isFinite(n)
    if (!isObj(v) || !num(v.endsAt) || !num(v.durationMs)) return { error: 'invalid timer' }
    if (v.durationMs < MIN_TIMER_MS || v.durationMs > MAX_TIMER_MS) return { error: 'timer must last 10 seconds to 4 hours' }
    const now = Date.now()
    if (v.endsAt < now - TIMER_LATE_MS || v.endsAt > now + v.durationMs + TIMER_EARLY_MS) return { error: 'timer end is out of range' }
    return { value: { endsAt: Math.round(v.endsAt), durationMs: Math.round(v.durationMs) } }
  },
  // The emoji participants may throw at notes (ephemeral, never stored). Each must be exactly one emoji grapheme.
  throwables(v) {
    const list = isObj(v) && Array.isArray(v.emojis) ? v.emojis : null
    const ok = typeof v?.enabled === 'boolean' && list && list.length >= 1 && list.length <= MAX_THROW_EMOJIS && list.every(isSingleEmoji) && new Set(list).size === list.length
    return ok ? { value: { enabled: v.enabled, emojis: [...list] } } : { error: `invalid throwables: enabled plus 1-${MAX_THROW_EMOJIS} different single emoji` }
  },
  // One step of the staged Retro workflow ({ type: 'next' }, { type: 'topic', itemId, status }, ...). Only the shape is checked
  // here; resolvePatch applies it to the stored state, where applyRetroAction validates the values.
  retro(v) {
    const allowed = isObj(v) && isStr(v.type) && Object.hasOwn(RETRO_ACTION_KEYS, v.type) ? RETRO_ACTION_KEYS[v.type] : null
    if (!allowed || Object.keys(v).some((k) => k !== 'type' && !allowed.includes(k))) return { error: 'invalid retro action' }
    return { value: { type: v.type, ...Object.fromEntries(allowed.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) } }
  },
  anonymousNotes: (v) => (ANON_MODES.includes(v) ? { value: v } : { error: 'anonymousNotes must be optional, always or never' }),
  status: (v) => (v === 'open' || v === 'closed' ? { value: v } : { error: 'status must be open or closed' }),
  revoked: (v) => (typeof v === 'boolean' ? { value: v } : { error: 'revoked must be a boolean' }),
  // AI summary settings, booleans only. This is only the shape: whether `ack` is needed and which flags make sense is
  // decided against the stored board in resolvePatch.
  ai(v) {
    const keys = isObj(v) ? Object.keys(v) : []
    if (!keys.length || keys.some((k) => !AI_KEYS.includes(k))) return { error: 'invalid ai settings' }
    if (keys.some((k) => typeof v[k] !== 'boolean')) return { error: 'ai settings must be true or false' }
    return { value: { ...v } }
  },
  // The owner's edit of the summary: new text and/or draft <-> shared; null deletes it.
  summary(v) {
    if (v === null) return { value: null }
    const keys = isObj(v) ? Object.keys(v) : []
    if (!keys.length || keys.some((k) => k !== 'text' && k !== 'status')) return { error: 'invalid summary' }
    const out = {}
    if (v.text !== undefined) {
      const text = cleanSummaryText(v.text)
      if (!text) return { error: 'summary text cannot be empty' }
      if (Array.from(text).length > MAX_SUMMARY) return { error: `summary can be up to ${MAX_SUMMARY} characters` }
      out.text = text
    }
    if (v.status !== undefined) {
      if (v.status !== 'draft' && v.status !== 'shared') return { error: 'summary status must be draft or shared' }
      out.status = v.status
    }
    return { value: out }
  },
  // The passcode itself is never stored: only its scrypt hash, under passcodeHash. null removes the passcode.
  async passcode(v) {
    if (v === null) return { key: 'passcodeHash', value: null }
    if (!isStr(v) || v.length < MIN_PASSCODE || v.length > MAX_PASSCODE) return { error: `passcode must be ${MIN_PASSCODE}-${MAX_PASSCODE} characters or null` }
    return { key: 'passcodeHash', value: await hashPassword(v) }
  },
}

// -> { value } with the fields to store, or { error }.
export async function checkPatch(patch) {
  if (!isObj(patch) || !Object.keys(patch).length) return { error: 'patch must be a non-empty object' }
  const out = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(RULES, k)) return { error: 'unknown setting' } // the key is not echoed back, so no response ever names an internal field
    const r = await RULES[k](v)
    if (r.error) return r
    out[r.key ?? k] = r.value
  }
  return { value: out }
}

// Turns what checkPatch accepted into the fields to store, using the board as it is now: the AI acknowledgement rule,
// the summary the edit applies to, and the moment a board was closed. -> { value } or { error }.
export function resolvePatch(board, value, now = Date.now()) {
  const out = { ...value }
  if (value.anonymousNotes && value.anonymousNotes !== 'never' && board.type !== 'retro') return { error: 'Anonymous notes are only available on retro boards' }
  if (value.ai) {
    const { ack, ...set } = value.ai
    const cur = aiOf(board)
    const next = { ...cur, ...set }
    if (set.enabled === true && !cur.ackAt) {
      if (ack !== true) return { error: 'Confirm that you understand what is sent before turning AI on' }
      next.ackAt = now
    }
    if (!next.enabled) {
      if (set.autoSummary || set.autoShare) return { error: 'Turn AI summaries on first' }
      next.autoSummary = false
      next.autoShare = false
    }
    out.ai = next
  }
  if (Object.hasOwn(value, 'summary')) {
    const edit = value.summary
    const cur = board.summary && typeof board.summary === 'object' ? board.summary : null
    if (edit === null) {
      out.summary = null
      if (board.summaryState === 'failed') Object.assign(out, { summaryState: 'idle', summaryError: null })
    } else if (!cur) {
      if (edit.text === undefined) return { error: 'There is no summary yet' }
      out.summary = { text: edit.text, status: edit.status ?? 'draft', source: 'manual', model: null, generatedAt: null, editedAt: now }
    } else {
      const changed = edit.text !== undefined && edit.text !== cur.text
      out.summary = { ...cur, ...(changed && { text: edit.text, editedAt: now }), ...(edit.status && { status: edit.status }) }
    }
  }
  if (Object.hasOwn(value, 'retro')) {
    if (board.type !== 'retro' || !isObj(board.retro)) return { error: 'This board has no retro workflow' }
    try {
      const next = applyRetroAction(board.retro, value.retro, now)
      out.retro = next
      // The shared vote and timer follow the stage; edits of notes, topics and the lock leave them alone.
      if (!['topic', 'setEditing'].includes(value.retro.type)) Object.assign(out, retroEffects(board.retro, next, board, now))
    } catch (e) {
      if (e instanceof RetroError) return { error: e.message }
      throw e
    }
  }
  // closedAt names a closure; it must differ from the one that last got an automatic summary even when the clock has not moved.
  if (value.status === 'closed' && (board.status !== 'closed' || !board.closedAt)) out.closedAt = Math.max(now, (Number(board.autoSummaryFor) || 0) + 1)
  if (value.status === 'open') out.closedAt = null
  return { value: out }
}
