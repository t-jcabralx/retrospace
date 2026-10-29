import { stripControl } from './ids.js'
import { getTemplate } from './templates.js'
import { validateColumns, validateHeader } from './columns.js'
import { ANON_KINDS } from './anon.js'

export const KINDS = ['note', 'text', 'shape', 'connector', 'frame', 'image', 'card', 'shoutout', 'theme', 'action']
export const REACTIONS = ['🎉', '❤️', '👏', '😂', '🙌', '🔥']
export const BADGES = ['Teamwork', 'Above & Beyond', 'Innovation', 'Customer Hero', 'Thank You']
export const SHAPES = ['rect', 'ellipse', 'diamond']
export const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange']
export const MAX_CARD_MESSAGE = 500
export const MAX_SIGNER = 40
const MAX_MEDIA_SIDE = 4000

const MAX_TEXT = 2000
const MAX_DATA_BYTES = 8 * 1024
// Per-key caps for the large fields (bytes). A board's whole pile of data URLs is also budgeted (see plan.js MAX_MEDIA).
export const LARGE_CAP = { src: 400 * 1024, image: 200 * 1024, gif: 4096 }
export const MAX_TITLE = 80
const MAX_ID = 40
// Large URL / data-URL fields: own 600 KB cap, excluded from the text and 8 KB limits, and only on the kinds listed.
const LARGE_KEYS = { image: ['src'], card: ['gif', 'image'], shoutout: ['gif'] }
const ALL_LARGE = new Set(['src', 'gif', 'image'])

export const IMG_URL = /^(data:image\/|https?:\/\/)/i
// An image item's src is a downscaled data URL or an https link (never plain http, never another scheme).
const SRC_URL = /^(data:image\/|https:\/\/)/i
const HTTPS_URL = /^https:\/\//i // a GIF is only ever a link, and only over https (card.image may still be a data:image)

const err = (error) => ({ ok: false, error })
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
const isId = (v) => isStr(v) && v.length > 0 && v.length <= MAX_ID
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const bytes = (s) => new TextEncoder().encode(s).length

// Per-field numeric rules: [min, max, default]
const NUM = { x: [-1e5, 1e5, 0], y: [-1e5, 1e5, 0], w: [20, 4000, 200], h: [20, 4000, 200], z: [-1e9, 1e9, 0], rot: [-3600, 3600, 0] }

function checkStrings(v, depth = 0) {
  if (isStr(v)) return v.length <= MAX_TEXT ? null : `text exceeds ${MAX_TEXT} chars`
  if (depth > 4) return 'data nested too deeply'
  if (Array.isArray(v)) {
    for (const x of v) { const e = checkStrings(x, depth + 1); if (e) return e }
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      const e = checkStrings(x, depth + 1)
      if (e) return e
    }
  }
  return null
}

// `allowed`: the large keys this data may carry. Anything else in ALL_LARGE is rejected.
function checkData(data, allowed) {
  if (!isObj(data)) return 'data must be an object'
  const rest = {}
  for (const [k, v] of Object.entries(data)) {
    if (!ALL_LARGE.has(k)) { rest[k] = v; continue }
    if (!allowed.includes(k)) return `${k} is not allowed here`
    if (!isStr(v)) return `${k} must be a string`
    const cap = LARGE_CAP[k]
    if (v.length > cap || bytes(v) > cap) return `${k} exceeds ${cap / 1024} KB`
    if (k === 'gif' ? !HTTPS_URL.test(v) : k === 'src' ? !SRC_URL.test(v) : !IMG_URL.test(v)) return k === 'gif' ? 'gif must be an https url' : k === 'src' ? 'image src must be an https or data:image url' : `${k} must be an http(s) or data:image url`
  }
  const e = checkStrings(rest)
  if (e) return e
  if (bytes(JSON.stringify(rest)) > MAX_DATA_BYTES) return 'data exceeds 8 KB'
  return null
}

const optStr = (d, k) => d[k] === undefined || isStr(d[k])
const optSide = (d, k) => d[k] === undefined || (typeof d[k] === 'number' && Number.isFinite(d[k]) && d[k] >= 1 && d[k] <= MAX_MEDIA_SIDE)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

// -> { message?, signer? } with friendly texts; empty when both are fine. The server and the card composer share it.
export function checkCardText(message, signer) {
  const errors = {}
  if (!isStr(message) || !message.trim()) errors.message = 'Write a message for your card'
  else if (message.length > MAX_CARD_MESSAGE) errors.message = `Messages can be up to ${MAX_CARD_MESSAGE} characters (now ${message.length})`
  if (!isStr(signer) || !signer.trim()) errors.signer = 'Sign your card with a name'
  else if (signer.length > MAX_SIGNER) errors.signer = `Names can be up to ${MAX_SIGNER} characters (now ${signer.length})`
  else if (CONTROL.test(signer)) errors.signer = 'The name cannot contain line breaks'
  return errors
}

export const MAX_THEME_TITLE = 60
export const MAX_THEME_NOTES = 50
// A theme links notes by id (the links are checked against live notes when they are shown, not here).
function checkTheme(d) {
  if (!isStr(d.title) || !d.title.trim() || d.title.length > MAX_THEME_TITLE) return 'theme needs a title of 1-60 characters'
  if (!Array.isArray(d.noteIds) || d.noteIds.length > MAX_THEME_NOTES || !d.noteIds.every(isId)) return 'theme noteIds must be up to 50 ids'
  return null
}

function checkCard(d) {
  if (!isStr(d.message) || !isStr(d.signer) || !isStr(d.color) || !optStr(d, 'gif') || !optStr(d, 'image')) return 'card needs message, signer, color'
  const text = checkCardText(d.message, d.signer)
  if (text.message || text.signer) return text.message ? 'card message must be 1-500 characters' : 'card signer must be 1-40 characters'
  if (!NOTE_COLORS.includes(d.color)) return 'card color must be one of the note colors'
  return optSide(d, 'mediaW') && optSide(d, 'mediaH') ? null : 'card media size is invalid'
}

// Wall shout-out limits: a name of 1-60 characters, a message of 1-500, a short person id, a numeric post time.
function checkShoutout(d) {
  if (!isStr(d.toName) || !isStr(d.message) || !BADGES.includes(d.badge) || !optStr(d, 'to') || !optStr(d, 'gif')) return 'shoutout needs toName, message, valid badge'
  if (!d.toName.trim() || d.toName.length > 60 || CONTROL.test(d.toName)) return 'shoutout toName must be 1-60 characters'
  if (!d.message.trim() || d.message.length > MAX_CARD_MESSAGE) return 'shoutout message must be 1-500 characters'
  if (d.to !== undefined && !isId(d.to)) return 'shoutout to must be a person id'
  if (d.at !== undefined && !(typeof d.at === 'number' && Number.isFinite(d.at))) return 'shoutout at must be a number'
  return null
}

// Minimal required shape per kind; returns an error string or null.
const KIND_CHECKS = {
  note: (d) => (isStr(d.text) && optStr(d, 'color') ? null : 'note needs text'),
  text: (d) => (isStr(d.text) ? null : 'text needs text'),
  shape: (d) => (SHAPES.includes(d.shape) && optStr(d, 'text') && optStr(d, 'color') ? null : 'shape needs rect|ellipse|diamond'),
  connector: (d) => (isId(d.from) && isId(d.to) ? null : 'connector needs from and to'),
  frame: (d) => (isStr(d.title) ? null : 'frame needs title'),
  image: (d) => (isStr(d.src) && SRC_URL.test(d.src) ? null : 'image needs a src url'),
  card: checkCard,
  theme: checkTheme,
  action: (d) => checkAction(d),
  shoutout: checkShoutout,
}

// --- retro action items: what the team will do, who owns it, by when ---
export const ACTION_STATUSES = ['open', 'doing', 'done']
export const ACTION_PRIORITIES = ['low', 'normal', 'high']
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const LIMITS = { action: [1, 200], owner: [0, 60], measure: [0, 200], notes: [0, 500] }
export function isRealDay(v) {
  const m = isStr(v) && ISO_DAY.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}
function checkAction(d) {
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = d[k] ?? (k === 'action' ? undefined : '')
    if (!isStr(v)) return `action ${k} must be text`
    const n = Array.from(v.trim()).length
    if (n < lo || n > hi) return k === 'action' ? 'action must be 1-200 characters' : `action ${k} can be up to ${hi} characters`
  }
  if (d.due !== undefined && d.due !== '' && !isRealDay(d.due)) return 'due must be a date (YYYY-MM-DD) or empty'
  if (d.status !== undefined && !ACTION_STATUSES.includes(d.status)) return 'status must be open, doing or done'
  if (d.priority !== undefined && !ACTION_PRIORITIES.includes(d.priority)) return 'priority must be low, normal or high'
  return null
}
// The stored shape of an action: known fields only, trimmed, defaults filled in.
const actionData = (d) => ({
  action: d.action.trim(), owner: (d.owner ?? '').trim(), due: d.due ?? '', measure: (d.measure ?? '').trim(),
  status: d.status ?? 'open', priority: d.priority ?? 'normal', notes: (d.notes ?? '').trim(),
})

 

function numeric(src, key) {
  const [lo, hi, def] = NUM[key]
  if (src[key] === undefined) return { value: def }
  if (typeof src[key] !== 'number' || !Number.isFinite(src[key])) return { error: `${key} must be a finite number` }
  return { value: clamp(src[key], lo, hi) }
}

export function validateItem(input) {
  if (!isObj(input)) return err('item must be an object')
  if (!isId(input.id)) return err('invalid id')
  if (!KINDS.includes(input.kind)) return err('unknown kind')
  const item = { id: input.id, kind: input.kind }
  for (const key of Object.keys(NUM)) {
    const n = numeric(input, key)
    if (n.error) return err(n.error)
    item[key] = n.value
  }
  const dataErr = checkData(input.data, LARGE_KEYS[input.kind] || []) || KIND_CHECKS[input.kind](input.data)
  if (dataErr) return err(dataErr)
  item.data = input.kind === 'action' ? actionData(input.data) : { ...input.data }
  // `anon` is a flag, true or absent (false is normalised away), and only for kinds that carry an author's words.
  if (input.anon !== undefined) {
    if (typeof input.anon !== 'boolean') return err('anon must be a boolean')
    if (input.anon && !ANON_KINDS.includes(input.kind)) return err('this item cannot be anonymous')
    if (input.anon) item.anon = true
  }
  return { ok: true, item }
}

// Patches carry no kind, so any large key is allowed here (each still capped per key and the rest of
// data at 8 KB). The store must re-run validateItem on the merged {...stored, ...patch} item, which is
// where the kind-specific enforcement happens.
function validatePatch(patch) {
  if (!isObj(patch)) return err('patch must be an object')
  if (Object.hasOwn(patch, 'anon')) return err('anon cannot be changed once posted')
  const out = {}
  for (const key of Object.keys(NUM)) {
    if (patch[key] === undefined) continue
    const n = numeric(patch, key)
    if (n.error) return err(n.error)
    out[key] = n.value
  }
  if (patch.data !== undefined) {
    const e = checkData(patch.data, [...ALL_LARGE])
    if (e) return err(e)
    out.data = { ...patch.data }
  }
  return { ok: true, patch: out }
}

export function validateOp(input) {
  if (!isObj(input)) return err('op must be an object')
  switch (input.op) {
    case 'add': {
      const r = validateItem(input.item)
      return r.ok ? { ok: true, op: { op: 'add', id: r.item.id, item: r.item } } : r
    }
    case 'update': {
      if (!isId(input.id)) return err('update needs id')
      const r = validatePatch(input.patch)
      return r.ok ? { ok: true, op: { op: 'update', id: input.id, patch: r.patch } } : r
    }
    case 'delete':
    case 'vote':
      return isId(input.id) ? { ok: true, op: { op: input.op, id: input.id } } : err(`${input.op} needs id`)
    case 'react':
      if (!isId(input.id)) return err('react needs id')
      return REACTIONS.includes(input.emoji) ? { ok: true, op: { op: 'react', id: input.id, emoji: input.emoji } } : err('unsupported reaction')
    default:
      return err('unknown op')
  }
}

export const MAX_RECIPIENT = 60

export function validateTitle(raw) {
  const value = isStr(raw) ? stripControl(raw) : ''
  if (!value) return err('title required')
  if (value.length > MAX_TITLE) return err(`title exceeds ${MAX_TITLE} chars`)
  return { ok: true, value }
}

// null (or undefined) means no recipient.
export function validateRecipient(raw) {
  if (raw == null) return { ok: true, value: null }
  const name = isObj(raw) && isStr(raw.name) ? stripControl(raw.name) : ''
  if (!name || name.length > MAX_RECIPIENT) return err('invalid recipient')
  return { ok: true, value: { name } }
}

export function validateBoardInput(body) {
  if (!isObj(body)) return err('body must be an object')
  const { type, template } = body
  if (!isStr(type) || !isStr(template) || !getTemplate(type, template)) return err('unknown type or template')
  const t = validateTitle(body.title)
  if (!t.ok) return t
  // Retro and Event boards are not for anyone in particular: a recipient sent with them is ignored, not stored.
  const r = type === 'retro' || type === 'event' ? { ok: true, value: null } : validateRecipient(body.recipient)
  if (!r.ok) return r
  const title = t.value
  const recipient = r.value
  // Custom columns apply to templates that lay out columns (retro, and the workshop templates with frames); for any other
  // template they are ignored, not stored. `header` is the retro starter's instruction text.
  const extra = {}
  if (type === 'retro' && body.votes !== undefined) {
    if (!Number.isInteger(body.votes) || body.votes < 1 || body.votes > 20) return err('votes per person must be a whole number from 1 to 20')
    extra.votes = body.votes
  }
  if (getTemplate(type, template).columns) {
    if (body.columns !== undefined) {
      const c = validateColumns(body.columns)
      if (!c.ok) return c
      extra.columns = c.columns
    }
    if (type === 'retro' && body.header !== undefined) {
      const h = validateHeader(body.header)
      if (!h.ok) return h
      extra.header = h.value
    }
  }
  return { ok: true, board: { type, template, title, recipient, ...extra } }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_EMAIL = 254
export const MAX_NAME = 60
export const MIN_PASSWORD = 10
export const MAX_PASSWORD = 128

export function checkEmail(raw) {
  const email = isStr(raw) ? raw.trim().toLowerCase() : ''
  return email.length <= MAX_EMAIL && EMAIL_RE.test(email) ? { ok: true, value: email } : err('invalid email')
}

// Passwords are never trimmed or altered; only the type and length are checked.
export function validateRegister(body) {
  if (!isObj(body)) return err('body must be an object')
  const email = checkEmail(body.email)
  if (!email.ok) return email
  const name = isStr(body.name) ? stripControl(body.name) : ''
  if (!name || Array.from(name).length > MAX_NAME) return err(`name must be 1-${MAX_NAME} characters`)
  const { password } = body
  if (!isStr(password) || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return err(`password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`)
  }
  return { ok: true, value: { email: email.value, name, password } }
}

export function validateLogin(body) {
  if (!isObj(body)) return err('body must be an object')
  const email = checkEmail(body.email)
  if (!email.ok) return email
  const { password } = body
  if (!isStr(password) || !password || password.length > MAX_PASSWORD) return err('invalid password')
  return { ok: true, value: { email: email.value, password } }
}
