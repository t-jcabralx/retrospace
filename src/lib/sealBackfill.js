// Moves existing records to the sealed form (or back), a batch at a time. Used by scripts/encrypt-backfill.mjs.
// Safe by design: it only reads unless `apply` is set; every record is checked to open back to exactly what it was before it
// is written; the write only happens if the record has not changed since it was read (otherwise it is skipped and picked up
// by the next run); and a failure leaves the record as it was.
import { isDeepStrictEqual } from 'node:util'
import { SEALED_COLLECTIONS, sealDoc, openDoc, sealState } from './seal.js'

const same = (a, b) => isDeepStrictEqual(a, b) // key order does not matter
const strip = (d) => { const { _id, ...rest } = d; return rest } // eslint-disable-line no-unused-vars

// -> the update that turns `raw` into `next`, touching only what differs.
function diff(raw, next) {
  const set = {}
  const unset = {}
  for (const [k, v] of Object.entries(next)) if (k !== '_id' && !same(raw[k], v)) set[k] = v
  for (const k of Object.keys(raw)) if (k !== '_id' && !(k in next)) unset[k] = ''
  return { ...(Object.keys(set).length && { $set: set }), ...(Object.keys(unset).length && { $unset: unset }) }
}

// db: a MongoDB database handle. mode: 'encrypt' (default) or 'decrypt'.
export async function backfill(db, cfg, { apply = false, mode = 'encrypt', batch = 200, collections = SEALED_COLLECTIONS, onProgress = () => {} } = {}) {
  if (mode === 'encrypt' && !cfg.configured) throw new Error('DATA_ENCRYPTION_KEY is not set')
  const report = {}
  for (const name of collections) {
    const col = db.collection(name)
    const r = { total: 0, sealed: 0, plain: 0, mixed: 0, changed: 0, skipped: 0, failed: 0 }
    report[name] = r
    let last = null
    for (;;) {
      const rows = await col.find(last === null ? {} : { _id: { $gt: last } }).sort({ _id: 1 }).limit(batch).toArray()
      if (!rows.length) break
      for (const raw of rows) {
        last = raw._id
        r.total++
        const st = sealState(name, raw)
        if (st.sealed && !st.plain) r.sealed++
        else if (st.plain && !st.sealed) r.plain++
        else if (st.sealed && st.plain) r.mixed++
        else r.sealed += raw.enc ? 1 : 0 // nothing to seal in this record

        const wants = mode === 'encrypt' ? st.plain > 0 : st.sealed > 0
        if (!wants) continue
        const next = mode === 'encrypt' ? sealDoc(cfg, name, strip(raw)) : { ...openDoc(cfg, name, raw) }
        // the record must mean exactly the same thing afterwards
        const before = openDoc(cfg, name, raw)
        const after = mode === 'encrypt' ? openDoc(cfg, name, next) : next
        if (!same(strip(before), strip(after))) { r.failed++; onProgress({ name, id: raw._id, error: 'does not round trip' }); continue }
        r.changed++
        if (!apply) continue
        const update = diff(raw, { ...next, _id: raw._id })
        const guard = { _id: raw._id, ...(raw.updatedAt !== undefined && { updatedAt: raw.updatedAt }), ...(raw.rev !== undefined && { rev: raw.rev }) }
        const res = await col.updateOne(guard, update)
        if (!res.matchedCount) { r.changed--; r.skipped++ } // changed under us: the next run gets it
      }
      onProgress({ name, done: r.total })
    }
  }
  return report
}
