// Access-code helpers shared by the join box and the join page. Pure and browser-safe.
import { isCode } from './ids.js'

export const CODE_LENGTH = 6

// Separators people type or paste inside a code (spaces, dashes, underscores, en/em dashes, zero-width characters)
// are dropped. Anything else is left as typed so isCode() can reject it.
const SEPARATORS = /[\s\-_\u2010-\u2015\u200b-\u200d\ufeff]+/g

export const normalizeCode = (raw) => (typeof raw === 'string' ? raw.replace(SEPARATORS, '').toUpperCase() : '')

// null when `code` is a valid access code, otherwise a short sentence saying what is wrong.
export function codeProblem(code) {
  if (isCode(code)) return null
  if (!code) return `Enter the ${CODE_LENGTH}-character code you were given`
  if (code.length !== CODE_LENGTH) return `Access codes are ${CODE_LENGTH} characters long`
  if (/[01ILO]/.test(code)) return 'Access codes never contain 0, 1, I, L or O — check for a look-alike character'
  return 'Access codes only use letters and numbers'
}

// Retry-After header (seconds) -> whole seconds between 1 and an hour, or null.
export function retryAfterSeconds(value) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? Math.min(3600, Math.max(1, n)) : null
}

export const waitText = (secs) => (secs ? `wait ${secs} ${secs === 1 ? 'second' : 'seconds'}` : 'wait a moment')

// Turns the answer of GET /api/join/<code> into { error } or { board }.
export function interpretJoin(status, data, retryAfter = null) {
  if (status === 404) return { error: "We couldn't find a board with that code" }
  if (status === 429) return { error: `Too many tries — ${waitText(retryAfter)}` }
  if (status === 400) return { error: codeProblem('') }
  if (status !== 200 || !data?.exists) return { error: 'Something went wrong. Please try again.' }
  if (data.revoked) return { error: 'This link was revoked' }
  return { board: { title: data.title, type: data.type, needsPasscode: !!data.needsPasscode, closed: !!data.closed } }
}
