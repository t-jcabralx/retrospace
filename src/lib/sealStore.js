// A drop-in wrapper around a MongoDB collection that seals what is written and opens what is read (see seal.js). The store
// code above it is unchanged: it asks for and receives ordinary documents. Writes are sealed only when `cfg.writing` (a key and
// DATA_ENCRYPTION_WRITE=on); with a key alone the wrapper only reads, opening whatever is sealed and leaving plain records
// plain, so deploying with a key changes nothing in the database.
import { sealConfig, sealDoc, openDoc, sealUpdate, blind, SEALED_COLLECTIONS } from './seal.js'
import { nameKey } from './persona.js'

const dupError = () => Object.assign(new Error('duplicate key'), { code: 11000 })

// bulkWrite: only whole-document replacements carry content in this app; anything else is passed on as it is.
const sealOp = (cfg, name, op) => (op.replaceOne ? { replaceOne: { ...op.replaceOne, replacement: sealDoc(cfg, name, op.replaceOne.replacement) } } : op.insertOne ? { insertOne: { document: sealDoc(cfg, name, op.insertOne.document) } } : op)

export function wrapCollection(cfg, name, raw) {
  if (!SEALED_COLLECTIONS.includes(name)) return raw
  const on = cfg.writing
  const reading = cfg.configured
  const open = (d) => openDoc(cfg, name, d)

  // Email lookups must find an account whether it is sealed (by blind index) or still plain.
  const lookup = (f) => {
    if (name === 'users' && reading && f && typeof f.email === 'string' && Object.keys(f).length === 1) return { $or: [{ emailIdx: blind(cfg, 'users-email', f.email.trim().toLowerCase()) }, { email: f.email }] }
    return f
  }
  const cursor = (c) => ({
    sort(s) { c = c.sort(s); return this },
    limit(n) { c = c.limit(n); return this },
    toArray: async () => (await c.toArray()).map(open),
  })

  // The unique indexes on the blind keys cannot see a legacy record (it still holds the plain value), so check for it here.
  async function noLegacyClash(doc, { uid } = {}) {
    if (!on) return
    if (name === 'users' && doc.email && await raw.findOne({ email: String(doc.email).trim().toLowerCase() }, { projection: { _id: 1 } })) throw dupError()
    if (name === 'participants' && doc.name && await raw.findOne({ boardCode: doc.boardCode, uid: { $ne: uid ?? doc.uid }, nameLower: nameKey(doc.name) }, { projection: { _id: 1 } })) throw dupError()
    if (name === 'templates' && doc.name && await raw.findOne({ ownerId: doc.ownerId, nameLower: String(doc.name).toLowerCase() }, { projection: { _id: 1 } })) throw dupError()
  }
  const fromUpdate = (f, u) => ({ ...f, ...(u?.$set ?? {}), ...(u?.$setOnInsert ?? {}) })
  const prep = async (f, u) => {
    if (!on) return u
    const set = u?.$set ?? u?.$setOnInsert
    if (set && 'name' in set && (name === 'participants')) await noLegacyClash({ boardCode: f.boardCode, name: set.name }, { uid: f.uid })
    return sealUpdate(cfg, name, f, u)
  }

  const wrapped = {
    sealing: reading, // sealed records may exist, so they are measured and looked up the sealed way
    raw,
    async insertOne(doc, o) { await noLegacyClash(doc); return raw.insertOne(on ? sealDoc(cfg, name, doc) : doc, o) },
    insertMany: (docs, o) => raw.insertMany(on ? docs.map((d) => sealDoc(cfg, name, d)) : docs, o),
    async findOne(f, o) { return open(await raw.findOne(lookup(f), o)) },
    find: (f, o) => cursor(raw.find(lookup(f), o)),
    async findOneAndUpdate(f, u, o) { return open(await raw.findOneAndUpdate(f, await prep(f, u), o)) },
    async updateOne(f, u, o) { return raw.updateOne(f, await prep(f, u), o) },
    bulkWrite: (ops, o) => raw.bulkWrite(on ? ops.map((op) => sealOp(cfg, name, op)) : ops, o),
  }
  void fromUpdate
  return new Proxy(wrapped, { get: (t, p) => (p in t ? t[p] : typeof raw[p] === 'function' ? raw[p].bind(raw) : raw[p]) })
}

export { sealConfig }
