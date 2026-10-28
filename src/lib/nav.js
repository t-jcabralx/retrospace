// Navigation helpers. Pure and browser-safe.
const MAX_NEXT = 200
const UNSAFE = /[\u0000-\u001f\u007f\\]/

// A `next` value from the query string is only followed when it is a plain same-origin path: one leading slash, no
// scheme or host, no backslash (some browsers treat it as a slash), no control characters, at most 200 characters.
// The sign-in and sign-up pages themselves are refused so a stray `next` cannot bounce between them.
export function safeNext(raw, fallback = '/boards') {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.length > MAX_NEXT) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE.test(value)) return fallback
  if (/^\/(login|register)(?![\w-])/.test(value)) return fallback
  return value
}

// /login or /register, carrying `next` when it is safe.
const withNext = (path, next) => {
  const safe = safeNext(next, '')
  return safe ? `${path}?next=${encodeURIComponent(safe).replace(/%2F/g, '/')}` : path
}
export const loginHref = (next) => withNext('/login', next)
export const registerHref = (next) => withNext('/register', next)
