// Encryption of what people typed, inside the database. Server only. See docs/specs/2026-10-29-encryption-at-rest-design.md.
//
// - A sealed value is a string `enc1.<keyId>.<nonce>.<ciphertext+tag>` (AES-256-GCM) stored in the field that held the plain
//   value, so a document keeps its shape. The collection, the document id and the field name are bound in as authenticated
//   data: a ciphertext moved to another record or field fails to open.
// - Keys: one master key from the environment (DATA_ENCRYPTION_KEY). Each board gets its own key derived from it (HKDF), and so
//   does each account, so nothing key-like is ever stored in the database.
// - Backward compatible by construction: a field that is not a sealed string is a legacy plain value and is returned as it is.
//   Nothing is sealed until a key is configured, and a document written before is only rewritten when the app writes it.
// - Blind indexes (an HMAC of the normalised value) keep "this email exists" and "that name is taken" working without storing
//   the email or the name in the clear.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { envValue } from './db.js'
import { nameKey } from './persona.js'

export const PREFIX = 'enc1.'
const b64 = (buf) => Buffer.from(buf).toString('base64url')

// -> { configured, kid, keys: Map<kid, Buffer> } from the environment. Old keys stay readable after a rotation.
export function sealConfig(env = process.env) {
  const raw = envValue('DATA_ENCRYPTION_KEY', env)
  const keys = new Map()
  const parse = (v) => {
    const buf = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64')
    if (buf.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (64 hex characters or 44 base64 characters)')
    return buf
  }
  const kid = envValue('DATA_ENCRYPTION_KEY_ID', env) || 'k1'
  if (raw) keys.set(kid, parse(raw))
  const old = envValue('DATA_ENCRYPTION_KEYS_OLD', env)
  if (old) {
    let map
    try { map = JSON.parse(old) } catch { throw new Error('DATA_ENCRYPTION_KEYS_OLD must be JSON like {"k0":"<key>"}') }
    for (const [id, v] of Object.entries(map)) if (!keys.has(id)) keys.set(id, parse(String(v)))
  }
  return { configured: Boolean(raw), kid, keys }
}

const derived = new WeakMap() // per configuration: two different master keys never share a derived key
function keyFor(cfg, kid, scope, purpose) {
  const master = cfg.keys.get(kid)
  if (!master) throw new Error(`No data encryption key "${kid}" is configured`)
  let cache = derived.get(cfg)
  if (!cache) derived.set(cfg, (cache = new Map()))
  const id = `${kid}|${purpose}|${scope}`
  let k = cache.get(id)
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', master, 'retrospace/seal/v1', `${purpose}:${scope}`, 32))
    if (cache.size > 4000) cache.clear()
    cache.set(id, k)
  }
  return k
}

export const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX)

export function sealValue(cfg, scope, aad, value) {
  const nonce = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyFor(cfg, cfg.kid, scope, 'data'), nonce)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(JSON.stringify(value === undefined ? null : value), 'utf8'), c.final(), c.getAuthTag()])
  return `${PREFIX}${cfg.kid}.${b64(nonce)}.${b64(ct)}`
}

export function openValue(cfg, scope, aad, text) {
  const [, kid, nonce, body] = text.split('.')
  if (!kid || !nonce || !body) throw new Error('Malformed encrypted value')
  const raw = Buffer.from(body, 'base64url')
  const d = createDecipheriv('aes-256-gcm', keyFor(cfg, kid, scope, 'data'), Buffer.from(nonce, 'base64url'))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(raw.subarray(raw.length - 16))
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'))
}

// A keyed hash of a normalised value, for equality lookups and unique indexes.
export const blind = (cfg, scope, value) => createHmac('sha256', keyFor(cfg, cfg.kid, scope, 'blind')).update(String(value)).digest('base64url').slice(0, 32)

// What each collection seals. `scope` picks the key (a board, or an account); `id` is bound into every ciphertext.
// `blind`: a lookup key that replaces a readable field (`from` is hashed into `to`, and `drop` is removed).
const S = {
  boards: { scope: (d) => d.code, id: (d) => d.code, seal: ['title', 'recipient', 'summary', 'wheel', 'themeSuggestions'] },
  items: { scope: (d) => d.boardCode, id: (d) => `${d.boardCode}/${d.id}`, seal: ['data', 'authorName', 'authorAvatar'] },
  participants: { scope: (d) => d.boardCode, id: (d) => `${d.boardCode}/${d.uid}`, seal: ['name', 'avatar'], blind: { from: (d) => nameKey(d.name), to: 'nameKey', drop: 'nameLower', needs: 'name' } },
  people: { scope: (d) => d.boardCode, id: (d) => `${d.boardCode}/${d.id}`, plain: ['_id', 'boardCode', 'id', 'createdAt', 'updatedAt'] },
  users: { scope: (d) => `user:${d.id}`, id: (d) => d.id, seal: ['name', 'email'], blind: { from: (d) => String(d.email).trim().toLowerCase(), to: 'emailIdx', needs: 'email', scope: () => 'users-email' } },
  templates: { scope: (d) => `user:${d.ownerId}`, id: (d) => d.id, seal: ['name', 'columns', 'header'], blind: { from: (d) => String(d.name).toLowerCase(), to: 'nameKey', drop: 'nameLower', needs: 'name' } },
}
export const SEALED_COLLECTIONS = Object.keys(S)
const fieldsOf = (spec, doc) => (spec.seal ? spec.seal : Object.keys(doc).filter((k) => !spec.plain.includes(k) && k !== 'enc'))

// The whole document, sealed. Fields already sealed are left alone, so sealing twice is harmless.
export function sealDoc(cfg, collection, doc) {
  const spec = S[collection]
  const out = { ...doc }
  const scope = spec.scope(doc)
  const aadBase = `${collection}:${spec.id(doc)}:`
  for (const f of fieldsOf(spec, doc)) {
    if (!Object.hasOwn(out, f) || isSealed(out[f])) continue
    out[f] = sealValue(cfg, scope, aadBase + f, out[f])
  }
  if (spec.blind && Object.hasOwn(doc, spec.blind.needs)) {
    if (!out[spec.blind.to]) out[spec.blind.to] = blind(cfg, spec.blind.scope ? spec.blind.scope(doc) : scope, spec.blind.from(isSealed(doc[spec.blind.needs]) ? openDoc(cfg, collection, doc) : doc))
    if (spec.blind.drop) delete out[spec.blind.drop]
  }
  out.enc = { v: 1, kid: cfg.kid }
  return out
}

// A document as the app sees it: every sealed field opened, the helper fields removed, the legacy shape restored.
export function openDoc(cfg, collection, doc) {
  if (!doc || typeof doc !== 'object') return doc
  const spec = S[collection]
  const sealed = Object.keys(doc).filter((k) => isSealed(doc[k]))
  if (!sealed.length) return doc // a legacy plain record: handed back untouched
  const out = { ...doc }
  const scope = spec.scope(doc)
  const aadBase = `${collection}:${spec.id(doc)}:`
  for (const f of sealed) out[f] = openValue(cfg, scope, aadBase + f, out[f])
  if (spec.blind) {
    if (spec.blind.to in out && spec.blind.drop && out[spec.blind.needs] !== undefined) out[spec.blind.drop] = collection === 'participants' ? nameKey(out.name) : String(out.name).toLowerCase()
    delete out[spec.blind.to]
  }
  delete out.enc
  return out
}

// Does this document still hold anything readable? -> { sealed: n, plain: n } over the fields that should be sealed.
export function sealState(collection, doc) {
  const spec = S[collection]
  let sealed = 0
  let plain = 0
  for (const f of fieldsOf(spec, doc)) {
    if (!Object.hasOwn(doc, f)) continue
    if (isSealed(doc[f])) sealed++
    else plain++
  }
  return { sealed, plain }
}

// The identity of a document taken from a query filter (the update paths know the document only by its filter).
function filterDoc(collection, filter) {
  const f = filter ?? {}
  const d = { code: f.code, boardCode: f.boardCode, id: f.id, uid: f.uid, ownerId: f.ownerId }
  return d
}

// `$set` / `$setOnInsert` with sealed fields. Needs the identity from the filter; a filter without it cannot be sealed safely.
export function sealUpdate(cfg, collection, filter, update) {
  const spec = S[collection]
  const out = { ...update }
  const d = filterDoc(collection, filter)
  let touched = false
  for (const op of ['$set', '$setOnInsert']) {
    if (!update[op]) continue
    const fields = fieldsOf(spec, update[op])
    const hit = fields.filter((f) => Object.hasOwn(update[op], f) && !isSealed(update[op][f]))
    const needsBlind = spec.blind && Object.hasOwn(update[op], spec.blind.needs)
    if (!hit.length && !needsBlind) continue
    let scope
    let id
    try { scope = spec.scope(d); id = spec.id(d) } catch { scope = undefined }
    if (!scope || scope.includes('undefined') || id.includes('undefined')) throw new Error(`Cannot seal an update of ${collection} without its identity in the filter`)
    const set = { ...update[op] }
    for (const f of hit) set[f] = sealValue(cfg, scope, `${collection}:${id}:${f}`, set[f])
    if (needsBlind) {
      const plain = { ...update[op] }
      set[spec.blind.to] = blind(cfg, spec.blind.scope ? spec.blind.scope(d) : scope, spec.blind.from(plain))
      if (spec.blind.drop) { delete set[spec.blind.drop]; out.$unset = { ...(out.$unset ?? {}), [spec.blind.drop]: '' } }
    }
    out[op] = set
    touched = true
  }
  return touched ? out : update
}
