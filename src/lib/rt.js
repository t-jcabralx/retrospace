// Realtime helpers: one Redis pub/sub channel per board. No Upstash configured -> everything here is a no-op.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getRedis } from './db.js'

export const chan = (code) => `kb:${code}`

// One secret, four HMAC namespaces. Every MAC input starts with its own tag, and no tag is a prefix of another, so a
// value signed for one purpose can never verify for another:
//   'tok:<code>:<boardId>:<exp>'   membership token (this file)
//   'access:<code>:<passcodeHash>' passcode access cookie (access.js)
//   'pid:<code>:<uid>' / 'pid:<code>:user:<userId>'   per-board public ids (guest.js)
//   'guest:<uid>'                  the rs_g cookie MAC (guest.js)
// Signing secret for membership tokens, access cookies, guest cookies and public ids. There is no hard-coded fallback in production: a
// forgeable secret would make every token and passcode cookie forgeable.
// In production it must be RT_SECRET itself: borrowing a vendor credential would tie every stored identity to it. Outside
// production the Upstash token (then a fixed dev value) stands in, so a local setup runs without ceremony.
export function rtSecret() {
  const s = process.env.RT_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('RT_SECRET must be set in production')
  return process.env.UPSTASH_REDIS_REST_TOKEN || 'dev-secret'
}

// Signed membership token '<expMs>.<hmac>': lets /send and /stream authorize without a Redis read. It expires
// (30 minutes; the client refreshes it) so a guest whose access was later withdrawn cannot keep using an old one.
// /stream also re-checks board access when it connects; /send relies on the token and its short life alone, since a
// board read per ephemeral message (up to 15 a second) would be too costly.
export const TOK_TTL_MS = 30 * 60 * 1000
const tokMac = (code, uid, exp) => createHmac('sha256', rtSecret()).update(`tok:${code}:${uid}:${exp}`).digest('hex').slice(0, 32)
export const signTok = (code, uid, now = Date.now(), ttlMs = TOK_TTL_MS) => {
  const exp = now + ttlMs
  return `${exp}.${tokMac(code, uid, exp)}`
}

export function verifyTok(code, uid, tok, now = Date.now()) {
  if (typeof tok !== 'string') return false
  const m = /^(\d{1,16})\.([0-9a-f]{32})$/.exec(tok)
  if (!m) return false
  const exp = Number(m[1])
  if (!Number.isSafeInteger(exp) || exp <= now) return false
  const a = Buffer.from(tokMac(code, uid, exp))
  const b = Buffer.from(m[2])
  return a.length === b.length && timingSafeEqual(a, b)
}

// Best effort: a failed publish must never fail the write that triggered it (clients catch up via /since).
// `redis` is injectable for tests.
export async function publish(code, env, redis = getRedis()) {
  if (!redis) return false
  try {
    await redis.publish(chan(code), JSON.stringify(env))
    return true
  } catch (e) {
    console.error('rt publish failed:', e.message)
    return false
  }
}

// In-process fallback limiter (used when Redis is absent). Bounded so unique uids cannot grow it forever.
const MAX_HITS = 5000
const hits = new Map()
export function rateLocal(uid, perSecond = 30) {
  const sec = Math.floor(Date.now() / 1000)
  const k = `${uid}:${sec}`
  const n = (hits.get(k) || 0) + 1
  hits.set(k, n)
  if (hits.size > MAX_HITS) {
    for (const key of hits.keys()) if (!key.endsWith(`:${sec}`)) hits.delete(key)
    if (hits.size > MAX_HITS) hits.clear()
  }
  return n <= perSecond
}

export async function rateOk(redis, uid, perSecond = 30) {
  const k = `rl:rt:${uid}:${Math.floor(Date.now() / 1000)}`
  const n = await redis.incr(k)
  if (n === 1) await redis.expire(k, 3)
  return n <= perSecond
}
