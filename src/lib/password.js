// Server-only (node:crypto). Stored form: scrypt$N$r$p$<salt base64>$<hash base64>
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const N = 32768 // 2^15; older hashes keep the N they were made with
const R = 8
const P = 1
const KEY_LEN = 64
const SALT_LEN = 16

// Parameters read back from a stored string are bounded so a corrupt row cannot trigger a huge allocation.
const MAX_N = 2 ** 17
const MAX_R = 16
const MAX_P = 4
const MAX_SALT = 64
const MAX_KEY = 128

const derive = (password, salt, n, r, p, keyLen) =>
  scryptAsync(password, salt, keyLen, { N: n, r, p, maxmem: 256 * n * r })

export async function hashPassword(password) {
  if (typeof password !== 'string') throw new TypeError('password must be a string')
  const salt = randomBytes(SALT_LEN)
  const hash = await derive(password, salt, N, R, P, KEY_LEN)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

const isPowerOfTwo = (n) => n >= 2 && (n & (n - 1)) === 0

// Canonical base64 only, so a mangled string is rejected rather than silently decoded to something else.
function b64(s, min, max) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null
  const buf = Buffer.from(s, 'base64')
  return buf.length >= min && buf.length <= max && buf.toString('base64') === s ? buf : null
}

function parse(stored) {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [n, r, p] = parts.slice(1, 4).map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : NaN))
  if (!isPowerOfTwo(n) || n > MAX_N) return null
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) return null
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return null
  const salt = b64(parts[4], 1, MAX_SALT)
  const hash = b64(parts[5], 1, MAX_KEY)
  return salt && hash ? { n, r, p, salt, hash } : null
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string') return false
  const parsed = parse(stored)
  if (!parsed) return false
  try {
    const got = await derive(password, parsed.salt, parsed.n, parsed.r, parsed.p, parsed.hash.length)
    return got.length === parsed.hash.length && timingSafeEqual(got, parsed.hash)
  } catch {
    return false
  }
}

// Burns a real scrypt for an unknown account so a miss costs the same as a wrong password. Always false.
// The dummy hash is created at import so the first unknown-email login does not pay for two scrypts; a failed
// attempt is forgotten so it is retried rather than cached forever.
// Passwords are deliberately not Unicode-normalised: they are hashed byte for byte as typed.
let dummyHash = warmDummy()
function warmDummy() {
  const p = hashPassword('retrospace-dummy-password')
  p.catch(() => { if (dummyHash === p) dummyHash = undefined })
  return p
}

export async function dummyVerify(password) {
  try {
    dummyHash ??= warmDummy()
    await verifyPassword(String(password ?? ''), await dummyHash)
  } catch { /* still answer false */ }
  return false
}
