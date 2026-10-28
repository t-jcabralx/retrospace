import { getRedis } from './db.js'

const MAX_BODY = 16 * 1024 // routes that take more (ops: pictures) say so; everything else is small JSON

export const json = (data, status = 200) => Response.json(data, { status })
export const fail = (status, error) => Response.json({ error }, { status })

// Throws on a body that is too large (err.status 413), not JSON, or not a JSON object.
export async function readJson(req, max = MAX_BODY) {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw Object.assign(new Error('too big'), { status: 413 }) // refused before reading it
  const text = await req.text()
  if (text.length > max) throw Object.assign(new Error('too big'), { status: 413 })
  let body
  try { body = JSON.parse(text) } catch { throw Object.assign(new Error('bad json'), { status: 400 }) }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('bad json'), { status: 400 })
  return body
}

// [body, null] or [null, errorResponse]
export async function parseBody(req, { max } = {}) {
  try {
    return [await readJson(req, max), null]
  } catch (e) {
    return e.status === 413 ? [null, fail(413, 'too big')] : [null, fail(400, 'bad json')]
  }
}

// The store returns full documents; no hash may ever reach a client. (ownerKeyHash only exists on boards made
// before accounts.)
export function stripBoard(board) {
  if (!board) return board
  const { passcodeHash, ownerKeyHash, bans, themeSuggestions, themesState, themesStartedAt, ...rest } = board // eslint-disable-line no-unused-vars -- the owner's theme suggestions are read from /themes only
  return rest
}

// In-process fixed-window counters, the fallback when Redis is absent or erroring. Two separate maps so cheap
// traffic cannot push a security counter out:
// - `local` (per-IP and other generic counters): bounded; when full, expired entries go first, then the oldest.
// - `cred` (credential-failure counters, `credential: true`): evicts expired entries only. When it is full of live
//   entries a new key is treated as over the limit (fail closed) instead of evicting a live counter.
const MAX_LOCAL = 5000
const MAX_CRED = 20000
const local = (globalThis._rsWindows ??= new Map())
const cred = (globalThis._rsCredWindows ??= new Map())
export const localWindowSize = () => local.size
export const credWindowSize = () => cred.size

function purgeExpired(map, now) {
  for (const [k, e] of map) if (e.exp <= now) map.delete(k)
}

function localHit(map, cap, strict, key, windowMs, now, peek) {
  const win = Math.floor(now / windowMs)
  let e = map.get(key)
  if (!e || e.win !== win) {
    if (peek) return 0
    map.delete(key) // re-insert so insertion order tracks recency
    if (strict && map.size >= cap) {
      purgeExpired(map, now)
      if (map.size >= cap) return Infinity
    }
    e = { win, exp: (win + 1) * windowMs, n: 0 }
    map.set(key, e)
    if (!strict && map.size > cap) {
      purgeExpired(map, now)
      for (const k of map.keys()) {
        if (map.size <= cap) break
        map.delete(k)
      }
    }
  }
  if (!peek) e.n++
  return e.n
}

// Counts hits for `key` in the current fixed window of `windowMs` and returns the count so far. `peek` reads
// without counting. Redis is used when configured; with `localFallback` the in-process counter covers a missing
// or failing Redis. Returns 0 when there is no counter to use (no Redis, no fallback, or Redis failed), and
// Infinity for a new `credential` key when the credential map is full of live entries.
// `redis` and `now` are injectable for tests.
export async function windowHit(key, windowMs, { localFallback = false, peek = false, credential = false, now = Date.now(), redis = getRedis() } = {}) {
  if (redis) {
    const rk = `rl:${key}:${Math.floor(now / windowMs)}`
    try {
      if (peek) return Number(await redis.get(rk)) || 0
      const n = await redis.incr(rk)
      if (n === 1) await redis.expire(rk, Math.ceil(windowMs / 1000) + 10)
      return n
    } catch {
      // fall through to the local counter when allowed
    }
  }
  if (!localFallback) return 0
  return credential ? localHit(cred, MAX_CRED, true, key, windowMs, now, peek) : localHit(local, MAX_LOCAL, false, key, windowMs, now, peek)
}

export const windowCount = (key, windowMs, opts = {}) => windowHit(key, windowMs, { ...opts, peek: true })

// Forgets a counter (best effort on Redis), e.g. after a successful login.
export async function windowClear(key, windowMs, { now = Date.now(), redis = getRedis() } = {}) {
  local.delete(key)
  cred.delete(key)
  if (!redis) return
  try { await redis.del(`rl:${key}:${Math.floor(now / windowMs)}`) } catch { /* it expires on its own */ }
}

// Gives one hit back to a counter (never below zero), e.g. the slot reserved by an attempt that turned out fine.
export async function windowRefund(key, windowMs, { now = Date.now(), redis = getRedis() } = {}) {
  const win = Math.floor(now / windowMs)
  for (const map of [local, cred]) {
    const e = map.get(key)
    if (e && e.win === win && e.n > 0) e.n--
  }
  if (!redis) return
  const rk = `rl:${key}:${win}`
  try {
    if ((await redis.decr(rk)) < 0) await redis.incr(rk) // it was already at zero
  } catch { /* the counter expires on its own */ }
}

// The value of cookie `name` from the Cookie header, or null.
export function readCookie(req, name) {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

// Only trustworthy behind a proxy that sets or overwrites these headers (see README, Deployment notes).
export function clientIp(req) {
  const h = req.headers
  const first = (v) => (v ? v.split(',')[0].trim() : '')
  return first(h.get('x-vercel-forwarded-for')) || first(h.get('x-real-ip')) || first(h.get('x-forwarded-for')) || 'local'
}

// Seconds until the current fixed window ends (at least 1).
export const retryAfterSecs = (windowMs, now = Date.now()) => Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000))

export const tooMany = (retryAfter, error = 'slow down') =>
  Response.json({ error }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })

// True when this IP exceeded `perMin` hits of `kind` in the current minute. Without Redis it never limits unless
// `{ localFallback: true }` is passed (use that for limits that guard credentials).
export async function rateLimited(req, kind, perMin, opts = {}) {
  const n = await windowHit(`${kind}:${clientIp(req)}`, 60_000, opts)
  return n > perMin
}
