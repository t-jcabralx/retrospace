// Browser-safe: only globalThis.crypto. Server-only hashing lives in hash.js.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const LIMIT = 256 - (256 % ALPHABET.length) // reject bytes above this to avoid modulo bias

function randomChars(n) {
  let out = ''
  while (out.length < n) {
    const buf = new Uint8Array(n * 2)
    globalThis.crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b < LIMIT && out.length < n) out += ALPHABET[b % ALPHABET.length]
    }
  }
  return out
}

const UID_RE = /^KM-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/
const CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/

export const newUid = () => `KM-${randomChars(4)}-${randomChars(4)}-${randomChars(4)}`
export const newCode = () => randomChars(6)
export const isUid = (s) => typeof s === 'string' && UID_RE.test(s)
export const isCode = (s) => typeof s === 'string' && CODE_RE.test(s)
// Per-tab client id: lets two tabs sharing one uid tell their own echoes from each other's changes.
export const isCid = (s) => typeof s === 'string' && s.length <= 40 && /^[\w-]+$/.test(s)

// Control and line/paragraph separator characters become spaces; runs of whitespace collapse.
export const stripControl = (s) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()

export function cleanName(s) {
  if (typeof s !== 'string') return 'Guest'
  const cleaned = stripControl(s)
  const name = Array.from(cleaned).slice(0, 24).join('').trim()
  return name || 'Guest'
}
