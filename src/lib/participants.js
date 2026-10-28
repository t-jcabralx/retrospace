// Server-only helpers around a board's participants (personas): what may be shown to others, the owner's automatic
// persona, and a short in-process cache for the high-rate /api/rt/send path.
import { avatarFromSeed } from './persona.js'

// At most this many participants per board, not counting the owner's own account row; the snapshot lists these plus
// the owner's row.
export const MAX_PARTICIPANTS = 300

// A viewer's own persona, and the public view of a participant. Never an email, user id or hash.
export const publicPersona = (p) => (p ? { kind: p.kind, name: p.name, avatar: p.avatar } : null)
export const publicParticipant = (p) => ({ uid: p.uid, name: p.name, avatar: p.avatar, kind: p.kind })

// The participant record for the public id `id` on `code`. The signed-in owner never has to choose: the first time
// they are seen on their board they appear as their account (account name, avatar derived from the user id).
export async function resolvePersona(store, code, id, { role, user }) {
  const existing = await store.getParticipant(code, id)
  if (existing || role !== 'owner' || !user) return existing
  try {
    return await store.joinParticipant(code, id, { kind: 'account', name: user.name, avatar: avatarFromSeed(user.id) })
  } catch (e) {
    if (e?.code === 11000) return null // someone else holds the name (validatePersona keeps guests off the owner's name)
    throw e
  }
}

// /api/rt/send relays up to 15 messages a second per guest, each of which must carry the stored name and avatar, so
// the record is read once per TTL instead of once per message. A persona change drops the entry in the process that
// served it; other processes catch up within the TTL. Misses are never cached.
const TTL_MS = 15_000
const MAX_ENTRIES = 2000
const cache = (globalThis._rsPersonaCache ??= new Map())

export function forgetParticipant(code, uid) {
  cache.delete(`${code}:${uid}`)
}

export async function cachedParticipant(store, code, uid, now = Date.now()) {
  const key = `${code}:${uid}`
  const hit = cache.get(key)
  if (hit && hit.exp > now) return hit.value
  const value = await store.getParticipant(code, uid)
  if (!value) { cache.delete(key); return null }
  cache.delete(key)
  cache.set(key, { value, exp: now + TTL_MS })
  if (cache.size > MAX_ENTRIES) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= MAX_ENTRIES) break }
  return value
}
