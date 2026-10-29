// A small in-memory stand-in for the MongoDB driver: just the operations src/lib/store.js uses, with unique indexes (E11000),
// so the real Mongo store can run in tests without a database. Not a general Mongo.
const clone = (v) => structuredClone(v)
const get = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc)
const eq = (a, b) => (Array.isArray(a) && !Array.isArray(b) ? a.some((x) => eq(x, b)) : JSON.stringify(a) === JSON.stringify(b))

function matches(doc, f = {}) {
  return Object.entries(f).every(([k, cond]) => {
    if (k === '$or') return cond.some((c) => matches(doc, c))
    const v = get(doc, k)
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$exists') return (v !== undefined) === arg
        if (op === '$in') return arg.some((x) => eq(v, x))
        if (op === '$ne') return Array.isArray(v) && !Array.isArray(arg) ? !v.some((x) => eq(x, arg)) : !eq(v, arg)
        if (op === '$gt') return v > arg
        if (op === '$lte') return v <= arg
        if (op === '$gte') return v >= arg
        throw new Error(`fake mongo: filter ${op}`)
      })
    }
    return eq(v, cond)
  })
}
const project = (doc, o) => { if (!doc) return null; const d = clone(doc); if (o?.projection?._id === 0) delete d._id; return d }

function applyUpdate(doc, u, inserting) {
  for (const [k, v] of Object.entries(u.$set ?? {})) doc[k] = clone(v)
  if (inserting) for (const [k, v] of Object.entries(u.$setOnInsert ?? {})) doc[k] = clone(v)
  for (const k of Object.keys(u.$unset ?? {})) delete doc[k]
  for (const [k, v] of Object.entries(u.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v
  for (const [k, v] of Object.entries(u.$max ?? {})) doc[k] = Math.max(doc[k] ?? -Infinity, v)
  for (const [k, v] of Object.entries(u.$addToSet ?? {})) { doc[k] ??= []; if (!doc[k].some((x) => eq(x, v))) doc[k].push(v) }
}

export class FakeCollection {
  constructor() { this.docs = []; this.unique = []; this.n = 0 }
  async createIndex(spec, opts = {}) { if (opts.unique) this.unique.push({ keys: Object.keys(spec), partial: opts.partialFilterExpression }) }
  checkUnique(doc, skip) {
    for (const u of this.unique) {
      if (u.partial && !matches(doc, u.partial)) continue
      // like the real thing, a missing field is the value null in a unique index (only a partial index leaves such records out)
      if (this.docs.some((d) => d !== skip && (!u.partial || matches(d, u.partial)) && u.keys.every((k) => eq(d[k] ?? null, doc[k] ?? null)))) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    }
  }
  async insertOne(doc) { const d = clone(doc); d._id ??= `id${++this.n}`; this.checkUnique(d); this.docs.push(d); doc._id = d._id; return { insertedId: d._id } }
  async insertMany(docs) { for (const d of docs) await this.insertOne(d); return { insertedCount: docs.length } }
  async findOne(f, o) { return project(this.docs.find((d) => matches(d, f)), o) }
  find(f, o) {
    let rows = this.docs.filter((d) => matches(d, f))
    const cur = {
      sort: (s) => { const [[k, dir]] = Object.entries(s); rows = [...rows].sort((a, b) => (a[k] > b[k] ? dir : a[k] < b[k] ? -dir : 0)); return cur },
      limit: (n) => { rows = rows.slice(0, n); return cur },
      toArray: async () => rows.map((d) => project(d, o)),
    }
    return cur
  }
  async countDocuments(f, o) { const n = this.docs.filter((d) => matches(d, f)).length; return o?.limit ? Math.min(n, o.limit) : n }
  async updateOne(f, u, o = {}) {
    let d = this.docs.find((x) => matches(x, f))
    if (!d) {
      if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }
      d = {}
      for (const [k, v] of Object.entries(f)) if (v === null || typeof v !== 'object') d[k] = v
      d._id = `id${++this.n}`
      applyUpdate(d, u, true)
      this.checkUnique(d)
      this.docs.push(d)
      return { matchedCount: 0, upsertedCount: 1 }
    }
    const before = clone(d)
    applyUpdate(d, u, false)
    try { this.checkUnique(d, d) } catch (e) { Object.assign(d, before); for (const k of Object.keys(d)) if (!(k in before)) delete d[k]; throw e }
    return { matchedCount: 1, modifiedCount: 1 }
  }
  async findOneAndUpdate(f, u, o = {}) {
    const d = this.docs.find((x) => matches(x, f))
    if (!d) return null
    const before = clone(d)
    applyUpdate(d, u, false)
    try { this.checkUnique(d, d) } catch (e) { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, before); throw e }
    return project(o.returnDocument === 'after' ? d : before, o)
  }
  async bulkWrite(ops) {
    for (const op of ops) {
      if (!op.replaceOne) throw new Error('fake mongo: bulkWrite op')
      const { filter, replacement, upsert } = op.replaceOne
      const i = this.docs.findIndex((x) => matches(x, filter))
      const next = { ...clone(replacement), _id: i >= 0 ? this.docs[i]._id : `id${++this.n}` }
      if (i < 0 && !upsert) continue
      this.checkUnique(next, i >= 0 ? this.docs[i] : undefined)
      if (i >= 0) this.docs[i] = next
      else this.docs.push(next)
    }
  }
  async deleteOne(f) { const i = this.docs.findIndex((d) => matches(d, f)); if (i >= 0) this.docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 } }
  async deleteMany(f) { const keep = this.docs.filter((d) => !matches(d, f)); const n = this.docs.length - keep.length; this.docs = keep; return { deletedCount: n } }
}

export function fakeClient() {
  const cols = new Map()
  const db = { collection: (name) => { if (!cols.has(name)) cols.set(name, new FakeCollection()); return cols.get(name) } }
  return { db: () => db, cols }
}
