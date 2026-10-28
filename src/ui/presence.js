// Who is on the board right now, built from the ephemeral messages peers broadcast. Pure: no React, no timers, no
// browser globals; `now` always comes from the caller, and every function returns a new value instead of changing its
// argument. The server stamps `name` and `avatar` onto `hello` and `cursor` messages from the stored persona; the sender
// is the envelope's `from` (a per-board public id), never a field inside `msg`.
//
// presence = { people: Map<from, { id, name|null, avatar|null, tabs: Map<tabKey, tab> }> }
// tab = { lastSeen, x?, y?, curAt?, ids?, selAt? }   (tabKey = the envelope's cid, else the sender)
import { validateAvatar, avatarFromSeed } from '../lib/persona.js'
import { isCid } from '../lib/ids.js'

export const PRESENCE_TTL_MS = 12_000 // a person who has not been heard from for this long has left
export const CURSOR_IDLE_MS = 10_000 // a cursor that has not moved for this long is hidden
const MAX_PEOPLE = 200
const MAX_TABS = 8
const MAX_SEL = 100
const MAX_ID = 40
const MAX_NAME = 40
const MAX_COORD = 1e6

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isCoord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

export const createPresence = () => ({ people: new Map() })

function cleanName(v) {
  if (typeof v !== 'string') return null
  const name = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()
  return name || null
}

// The persona a message carries, or null when it carries none (a sel message, say) or the name is unusable.
function personaOf(msg) {
  const name = cleanName(msg.name)
  if (!name) return null
  const v = validateAvatar(msg.avatar)
  return { name, avatar: v.ok ? v.avatar : avatarFromSeed(name) }
}

// The key whose `seen(value)` is lowest.
const oldest = (map, seen) => {
  let key = null
  let at = Infinity
  for (const [k, v] of map) if (seen(v) < at) { at = seen(v); key = k }
  return key
}
const lastSeenOf = (person) => Math.max(0, ...[...person.tabs.values()].map((t) => t.lastSeen))

// -> the message's effect on one tab, or null when the message is not valid for its type.
function tabUpdate(msg, now) {
  switch (msg.t) {
    case 'hello':
      return personaOf(msg) ? {} : null // a hello without a usable persona says nothing worth showing
    case 'cursor':
      return isCoord(msg.x) && isCoord(msg.y) ? { x: msg.x, y: msg.y, curAt: now } : null
    case 'sel': {
      const ok = Array.isArray(msg.ids) && msg.ids.length <= MAX_SEL && msg.ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= MAX_ID)
      return ok ? { ids: [...new Set(msg.ids)], selAt: now } : null
    }
    default:
      return null
  }
}

// env = { from, cid?, msg }. Anything malformed or of a type presence does not use returns `p` itself.
export function applyEphemeral(p, env, now) {
  if (!isObj(env) || typeof env.from !== 'string' || !env.from || env.from.length > 64 || !isObj(env.msg)) return p
  if (env.cid !== undefined && !isCid(env.cid)) return p
  const update = tabUpdate(env.msg, now)
  if (!update) return p
  const persona = env.msg.t === 'hello' || env.msg.t === 'cursor' ? personaOf(env.msg) : null
  if (env.msg.t === 'cursor' && !persona) return p // the server always stamps cursors; one without a name is not from our server

  const people = new Map(p.people)
  const cur = people.get(env.from)
  const person = cur
    ? { ...cur, tabs: new Map(cur.tabs) }
    : { id: env.from, name: null, avatar: null, tabs: new Map() }
  if (persona) { person.name = persona.name; person.avatar = persona.avatar }
  const key = env.cid ?? env.from
  person.tabs.set(key, { ...person.tabs.get(key), ...update, lastSeen: now })
  if (person.tabs.size > MAX_TABS) person.tabs.delete(oldest(person.tabs, (t) => t.lastSeen))
  people.delete(env.from) // re-insert: insertion order tracks recency
  people.set(env.from, person)
  if (people.size > MAX_PEOPLE) people.delete(oldest(people, lastSeenOf))
  return { people }
}

// Drops tabs (and people left with none) that were silent for more than `ttl`. Returns `p` when nothing expired.
export function prune(p, now, ttl = PRESENCE_TTL_MS) {
  let changed = false
  const people = new Map()
  for (const [id, person] of p.people) {
    const tabs = new Map([...person.tabs].filter(([, t]) => now - t.lastSeen <= ttl))
    if (tabs.size === person.tabs.size) { people.set(id, person); continue }
    changed = true
    if (tabs.size) people.set(id, { ...person, tabs })
  }
  return changed ? { people } : p
}

const named = (p) => [...p.people.values()].filter((x) => x.name)
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// -> [{ id, name, avatar, lastSeen, tabs }] sorted by name. People who have not shown a persona yet are left out.
export function peers(p) {
  return named(p).map((x) => ({ id: x.id, name: x.name, avatar: x.avatar, lastSeen: lastSeenOf(x), tabs: x.tabs.size })).sort(byName)
}

// -> one entry per TAB that has a cursor: { key, id, name, avatar, x, y, lastSeen } with x, y in world coordinates and
// lastSeen the time of its last cursor message. With `now`, cursors idle for more than `idleMs` are left out.
export function cursors(p, now, idleMs = CURSOR_IDLE_MS) {
  const out = []
  for (const x of named(p)) {
    for (const [key, t] of x.tabs) {
      if (t.curAt === undefined || (now !== undefined && now - t.curAt > idleMs)) continue
      out.push({ key, id: x.id, name: x.name, avatar: x.avatar, x: t.x, y: t.y, lastSeen: t.curAt })
    }
  }
  return out.sort((a, b) => byName(a, b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

// -> [{ id, name, avatar, ids }]: each person's latest non-empty selection (the most recent of their tabs).
export function selections(p) {
  const out = []
  for (const x of named(p)) {
    let latest = null
    for (const t of x.tabs.values()) if (t.selAt !== undefined && (!latest || t.selAt >= latest.selAt)) latest = t
    if (latest?.ids.length) out.push({ id: x.id, name: x.name, avatar: x.avatar, ids: [...latest.ids] })
  }
  return out.sort(byName)
}

// --- the live-region announcement when people come and go ---
export function rosterChanges(prev, next) {
  const was = new Set(prev.map((x) => x.id))
  const is = new Set(next.map((x) => x.id))
  return { joined: next.filter((x) => !was.has(x.id)).map((x) => x.name), left: prev.filter((x) => !is.has(x.id)).map((x) => x.name) }
}

const phrase = (names, verb) => (names.length === 1 ? `${names[0]} ${verb}` : `${names[0]} and ${names.length - 1} ${names.length === 2 ? 'other' : 'others'} ${verb}`)

export function announceText({ joined, left }) {
  const parts = [joined.length && phrase(joined, 'joined'), left.length && phrase(left, 'left')].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}
