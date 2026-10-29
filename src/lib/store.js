import { planOps, planClearVotes, mediaSize } from './plan.js'
import { DEFAULT_PER_PERSON } from './vote.js'
import { getMongo, dbName, envValue } from './db.js'
import { nameKey } from './persona.js'
import { sealConfig } from './seal.js'
import { wrapCollection } from './sealStore.js'
import { planTombstones, TOMBSTONE_FIELDS, MAX_BANS, bansFullError } from './ownerTools.js'

// Both stores return plain copies (no Mongo _id, nothing aliasing internal state) and share planOps for every rule.
const clone = (v) => structuredClone(v)
const byUpdatedAt = (a, b) => a.updatedAt - b.updatedAt
const newestFirst = (a, b) => b.updatedAt - a.updatedAt
// `rev` counts settings changes (PATCH) only; item ops never touch it and no client patch can set it.
const PROTECTED = ['_id', 'code', 'lastTs', 'ownerId', 'rev', 'bans']
const rejectAll = (ops, error) => ({ applied: [], rejected: ops.map((o) => ({ id: o.id, error })) })

function boardDoc(board) {
  const now = Date.now()
  return { locked: false, status: 'open', revoked: false, passcodeHash: null, createdAt: now, updatedAt: now, lastTs: 0, ...clone(board), rev: 0 }
}

function boardPatch(patch) {
  const out = { ...clone(patch), updatedAt: Date.now() }
  for (const k of PROTECTED) delete out[k]
  return out
}

const withBoardCode = (code, people) => people.map((p) => ({ ...clone(p), boardCode: code }))

const newMemState = () => ({ boards: new Map(), items: new Map(), people: new Map(), participants: new Map(), users: new Map(), usersById: new Map(), sessions: new Map(), templates: new Map() })

const normEmail = (email) => String(email).trim().toLowerCase()
const dupError = (what) => Object.assign(new Error(what), { code: 11000 })
const lockedError = () => Object.assign(new Error('Persona is fixed once you have added something'), { code: 'PERSONA_LOCKED' })

// A participant record is { boardCode, uid, kind, name, nameLower, avatar, joinedAt, updatedAt }. `uid` is the board's
// PUBLIC id for the participant (see guest.js), never the browser's cookie uid. Names are unique per board
// (`nameLower` is the confusable-folded nameKey), the owner's account persona included: the owner has ONE row per board
// (their id comes from the account, not the browser).
const personaFields = (p, now) => ({ kind: p.kind, name: p.name, nameLower: nameKey(p.name), avatar: clone(p.avatar), updatedAt: now })
const participantDoc = (code, uid, p) => {
  const now = Date.now()
  return { boardCode: code, uid, ...personaFields(p, now), joinedAt: now }
}

export function createMemoryStore(state = newMemState()) {
  state.participants ??= new Map() // code -> Map uid -> record
  state.users ??= new Map() // keyed by normalised email
  state.usersById ??= new Map()
  state.sessions ??= new Map() // keyed by tokenHash
  state.templates ??= new Map() // keyed by id: the owners' saved column templates
  const itemsOf = (code) => state.items.get(code) ?? new Map()
  const peopleOf = (code) => state.participants.get(code) ?? new Map()
  const nameTaken = (code, uid, p) => [...peopleOf(code).values()].some((r) => r.uid !== uid && r.nameLower === nameKey(p.name))
  const authored = (code, uid) => [...itemsOf(code).values()].filter((i) => i.authorUid === uid).length
  return {
    async createBoard(board) {
      if (state.boards.has(board.code)) throw Object.assign(new Error('Board code taken'), { code: 11000 })
      const doc = boardDoc(board)
      state.boards.set(doc.code, doc)
      state.items.set(doc.code, new Map())
      return clone(doc)
    },
    async getBoard(code) {
      const b = state.boards.get(code)
      return b ? clone(b) : null
    },
    async updateBoard(code, patch) {
      const b = state.boards.get(code)
      if (!b) return null
      Object.assign(b, boardPatch(patch))
      b.rev = (b.rev ?? 0) + 1 // single-threaded: this is atomic
      return clone(b)
    },
    // Writes `patch` only if the board is still at settings revision `rev` (a board written before revisions existed is at 0).
    // -> the updated board, or null when someone else changed it first (or it is gone). Atomic: one process, no await.
    async casBoard(code, rev, patch) {
      const b = state.boards.get(code)
      if (!b || (b.rev ?? 0) !== rev) return null
      Object.assign(b, boardPatch(patch))
      b.rev = rev + 1
      return clone(b)
    },
    // Takes the single "writing a summary" slot of a board. -> the updated board, or null when someone else holds the slot
    // (a flag older than staleMs no longer counts) or, for an automatic summary (`autoFor` = the closedAt it is for), when
    // the board is not closed since then or that closure already had its automatic summary. Atomic: one process, no await.
    async claimSummary(code, { now = Date.now(), staleMs, autoFor } = {}) {
      const b = state.boards.get(code)
      if (!b) return null
      if (b.summaryState === 'generating' && (b.summaryStartedAt ?? 0) > now - staleMs) return null
      if (autoFor !== undefined) {
        if (b.status !== 'closed' || b.closedAt !== autoFor || b.autoSummaryFor === autoFor) return null
        b.autoSummaryFor = autoFor
      }
      Object.assign(b, { summaryState: 'generating', summaryStartedAt: now, summaryError: null, updatedAt: Date.now() })
      b.rev = (b.rev ?? 0) + 1
      return clone(b)
    },
    // Takes the single "suggesting themes" slot of a board (same rules as claimSummary). -> the updated board, or null.
    async claimThemes(code, { now = Date.now(), staleMs } = {}) {
      const b = state.boards.get(code)
      if (!b) return null
      if (b.themesState === 'generating' && (b.themesStartedAt ?? 0) > now - staleMs) return null
      Object.assign(b, { themesState: 'generating', themesStartedAt: now, updatedAt: Date.now() })
      b.rev = (b.rev ?? 0) + 1
      return clone(b)
    },
    async deleteBoard(code) {
      state.boards.delete(code)
      state.items.delete(code)
      state.people.delete(code)
      state.participants.delete(code)
    },
    async getParticipant(code, uid) {
      const r = peopleOf(code).get(uid)
      return r ? clone(r) : null
    },
    async joinParticipant(code, uid, persona) {
      const existing = peopleOf(code).get(uid)
      if (existing) return clone(existing)
      if (nameTaken(code, uid, persona)) throw dupError('Name taken')
      const doc = participantDoc(code, uid, persona)
      if (!state.participants.has(code)) state.participants.set(code, new Map())
      state.participants.get(code).set(uid, doc)
      return clone(doc)
    },
    async updateParticipant(code, uid, persona, { lockWhenAuthored = true } = {}) {
      const r = peopleOf(code).get(uid)
      if (!r) return null
      if (lockWhenAuthored && authored(code, uid) > 0) throw lockedError()
      if (nameTaken(code, uid, persona)) throw dupError('Name taken')
      Object.assign(r, personaFields(persona, Date.now()))
      return clone(r)
    },
    async listParticipants(code) {
      return clone([...peopleOf(code).values()].sort((a, b) => a.joinedAt - b.joinedAt))
    },
    async countAuthoredItems(code, uid) {
      return authored(code, uid)
    },
    // Owner removal of a participant (see ownerTools.js): the row goes (the persona name is freed), the public id is banned
    // (owner-only `board.bans`, capped), and with `deleteItems` their live items are tombstoned with strictly increasing
    // updatedAt. -> { existed, wasBanned, changed } | null (no such board); throws BANS_FULL.
    async removeParticipant(code, id, { deleteItems = false, now = Date.now() } = {}) {
      const b = state.boards.get(code)
      if (!b) return null
      const wasBanned = (b.bans ?? []).includes(id)
      if (!wasBanned && (b.bans ?? []).length >= MAX_BANS) throw bansFullError()
      if (!wasBanned) b.bans = [...(b.bans ?? []), id]
      const existed = peopleOf(code).delete(id)
      let changed = []
      if (deleteItems) {
        const plan = planTombstones(b, [...itemsOf(code).values()].sort(byUpdatedAt), id, now)
        changed = plan.changed
        for (const item of changed) itemsOf(code).set(item.id, clone(item))
        if (changed.length) { b.lastTs = plan.lastTs; b.updatedAt = Math.max(b.updatedAt, plan.lastTs) }
      }
      return { existed, wasBanned, changed: clone(changed) }
    },
    async listItems(code) {
      return clone([...itemsOf(code).values()].filter((i) => !i.deleted).sort(byUpdatedAt))
    },
    async itemsSince(code, t) {
      return clone([...itemsOf(code).values()].filter((i) => i.updatedAt > t).sort(byUpdatedAt))
    },
    async applyOps(code, ops, actor) {
      const board = state.boards.get(code)
      if (!board) return rejectAll(ops, 'Board not found')
      const items = itemsOf(code)
      const plan = planOps(board, items, ops, actor, Date.now())
      for (const { item } of plan.writes) items.set(item.id, clone(item))
      if (plan.writes.length) {
        board.lastTs = plan.lastTs
        board.updatedAt = Math.max(board.updatedAt, plan.lastTs)
      }
      return { applied: clone(plan.applied), rejected: plan.rejected }
    },
    // Owner reset of a vote round: -> the item docs that changed (see planClearVotes). rev is not touched.
    async clearVotes(code) {
      const board = state.boards.get(code)
      if (!board) return { changed: [], skipped: 0 }
      const items = itemsOf(code)
      const { changed, lastTs } = planClearVotes(board, [...items.values()].sort(byUpdatedAt), Date.now())
      for (const item of changed) items.set(item.id, clone(item))
      if (changed.length) {
        board.lastTs = lastTs
        board.updatedAt = Math.max(board.updatedAt, lastTs)
      }
      return { changed: clone(changed), skipped: 0 } // one process, no await between read and write: nothing can interleave
    },
    async listPeople(code) {
      return clone(state.people.get(code) ?? [])
    },
    async savePeople(code, people) {
      const saved = withBoardCode(code, people)
      state.people.set(code, saved)
      return clone(saved)
    },
    async listBoardsByOwner(ownerId) {
      return clone([...state.boards.values()].filter((b) => b.ownerId === ownerId).sort(newestFirst))
    },
    async createUser(user) {
      const doc = { ...clone(user), email: normEmail(user.email) }
      if (state.users.has(doc.email)) throw dupError('Email taken')
      state.users.set(doc.email, doc)
      state.usersById.set(doc.id, doc)
      return clone(doc)
    },
    async getUserByEmail(email) {
      const u = state.users.get(normEmail(email))
      return u ? clone(u) : null
    },
    async getUserById(id) {
      const u = state.usersById.get(id)
      return u ? clone(u) : null
    },
    // Saved column templates (see columns.js). Unique per owner by nameLower; a duplicate throws code 11000.
    async createTemplate(tpl) {
      const doc = { ...clone(tpl), nameLower: tpl.name.toLowerCase() }
      if ([...state.templates.values()].some((t) => t.ownerId === doc.ownerId && t.nameLower === doc.nameLower)) throw dupError('Template name taken')
      state.templates.set(doc.id, doc)
      return clone(doc)
    },
    async listTemplates(ownerId) {
      return clone([...state.templates.values()].filter((t) => t.ownerId === ownerId).sort((a, b) => b.createdAt - a.createdAt))
    },
    async deleteTemplate(ownerId, id) {
      const t = state.templates.get(id)
      if (!t || t.ownerId !== ownerId) return false
      state.templates.delete(id)
      return true
    },
    async createSession(session) {
      if (state.sessions.has(session.tokenHash)) throw dupError('Session exists')
      state.sessions.set(session.tokenHash, clone(session))
    },
    async getSessionByTokenHash(h, now = Date.now()) {
      const s = state.sessions.get(h)
      if (!s) return null
      if (s.expiresAt <= now) { state.sessions.delete(h); return null }
      return clone(s)
    },
    async deleteSession(h) {
      state.sessions.delete(h)
    },
    async touchSession(h, now = Date.now()) {
      const s = state.sessions.get(h)
      if (s) s.lastSeenAt = now
    },
    // Account removal: every sign-in, every template and the account itself. (The boards go through deleteBoard.)
    async deleteSessionsByUser(userId) {
      for (const [h, s] of state.sessions) if (s.userId === userId) state.sessions.delete(h)
    },
    async deleteTemplatesByOwner(ownerId) {
      for (const [id, t] of state.templates) if (t.ownerId === ownerId) state.templates.delete(id)
    },
    async deleteUser(id) {
      const u = state.usersById.get(id)
      if (!u) return false
      state.usersById.delete(id)
      for (const [email, v] of state.users) if (v.id === id) state.users.delete(email)
      return true
    },
  }
}

const NO_ID = { projection: { _id: 0 } }

// Bytes of data: URLs in a board's live items (their strings are ASCII, so characters = bytes).
async function mediaBytesOf(items, code) {
  if (items.sealing) { // the contents are encrypted in the database, so they are measured here instead of by an aggregate
    const live = await items.find({ boardCode: code, deleted: false, kind: { $in: ['image', 'card', 'shoutout'] } }, NO_ID).toArray()
    return live.reduce((sum, i) => sum + mediaSize(i), 0)
  }
  const len = (path) => ({ $cond: [{ $eq: [{ $substrCP: [{ $ifNull: [path, ''] }, 0, 5] }, 'data:'] }, { $strLenCP: path }, 0] })
  const [row] = await items.aggregate([
    { $match: { boardCode: code, deleted: false, kind: { $in: ['image', 'card', 'shoutout'] } } },
    { $group: { _id: null, n: { $sum: { $add: [len('$data.src'), len('$data.image'), len('$data.gif')] } } } },
  ]).toArray()
  return row?.n ?? 0
}
const GUARD_TRIES = 3

// Rewrites ONE item only if nobody has written it since `doc` was read: the filter pins its updatedAt, so a concurrent
// write is never overwritten. A miss re-reads the item and tries again (up to GUARD_TRIES). `edit(current)` -> the fields
// to $set, or null when there is nothing left to do. The new updatedAt is strictly above the item's previous one and at
// least `floor()` (so it also moves the board's lastTs forward). -> { doc, changed } | { skipped: true }.
async function guardedUpdate(items, code, doc, edit, floor) {
  let cur = doc
  for (let i = 0; i < GUARD_TRIES; i++) {
    const fields = edit(cur)
    if (!fields) return { doc: cur, changed: false }
    const updatedAt = Math.max((cur.updatedAt || 0) + 1, floor())
    const res = await items.findOneAndUpdate({ boardCode: code, id: cur.id, updatedAt: cur.updatedAt }, { $set: { ...fields, updatedAt } }, { returnDocument: 'after', ...NO_ID })
    if (res) return { doc: res, changed: true }
    cur = await items.findOne({ boardCode: code, id: cur.id }, NO_ID)
    if (!cur || cur.deleted) return { doc: cur, changed: false }
  }
  return { skipped: true }
}

// Creates the indexes once per `state`. The promise never rejects (a failed index must not break the current
// read/write), but a failure is logged and forgotten so the next call retries.
export function ensureIndexes(c, state, { sealing = false } = {}) {
  state.ready ??= Promise.all([
    ...(sealing ? [ // the lookup key that stands in for the readable email; partial, so records that do not have it yet are not in the index
      c.users.createIndex({ emailIdx: 1 }, { unique: true, partialFilterExpression: { emailIdx: { $exists: true } } }),
    ] : []),
    c.boards.createIndex({ code: 1 }, { unique: true }),
    c.boards.createIndex({ ownerId: 1, updatedAt: -1 }),
    c.items.createIndex({ boardCode: 1, id: 1 }, { unique: true }),
    c.items.createIndex({ boardCode: 1, updatedAt: 1 }),
    c.people.createIndex({ boardCode: 1, id: 1 }),
    c.participants.createIndex({ boardCode: 1, uid: 1 }, { unique: true }),
    c.participants.createIndex({ boardCode: 1, nameLower: 1 }, { unique: true }),
    c.users.createIndex({ email: 1 }, { unique: true }),
    c.users.createIndex({ id: 1 }, { unique: true }),
    c.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // TTL: Mongo deletes expired sessions
  ]).catch((err) => {
    state.ready = undefined
    console.error('retrospace: index creation failed, will retry:', err?.message)
  })
  return state.ready
}

// `client` may be a MongoClient, a promise of one, or a function returning either. A function is called on every
// store call, so a failed connect is retried instead of being captured forever.
export function createMongoStore(client, name) {
  const state = {}
  const seal = sealConfig() // no DATA_ENCRYPTION_KEY: nothing is sealed, and what already is stays readable only with a key
  const cols = async () => {
    const resolved = await (typeof client === 'function' ? client() : client)
    if (state.client !== resolved) { state.client = resolved; state.ready = undefined } // new client after a reconnect: re-ensure indexes
    const db = resolved.db(name)
    const raw = { boards: db.collection('boards'), items: db.collection('items'), people: db.collection('people'), participants: db.collection('participants'), users: db.collection('users'), sessions: db.collection('sessions') }
    await ensureIndexes(raw, state, { sealing: seal.configured })
    return { ...raw, boards: wrapCollection(seal, 'boards', raw.boards), items: wrapCollection(seal, 'items', raw.items), people: wrapCollection(seal, 'people', raw.people), participants: wrapCollection(seal, 'participants', raw.participants), users: wrapCollection(seal, 'users', raw.users) }
  }

  // The templates collection ensures its own indexes (once per client), apart from ensureIndexes above.
  const tplCol = async () => {
    const resolved = await (typeof client === 'function' ? client() : client)
    const col = resolved.db(name).collection('templates')
    if (state.tplClient !== resolved) {
      state.tplClient = resolved
      state.tplReady = Promise.all([
        col.createIndex({ ownerId: 1, createdAt: -1 }),
        col.createIndex({ ownerId: 1, nameLower: 1 }, { unique: true }),
        col.createIndex({ id: 1 }, { unique: true }),
      ]).catch((err) => {
        state.tplClient = undefined
        console.error('retrospace: template index creation failed, will retry:', err?.message)
      })
    }
    await state.tplReady
    return wrapCollection(seal, 'templates', col)
  }

  return {
    async createBoard(board) {
      const { boards } = await cols()
      const doc = boardDoc(board)
      await boards.insertOne({ ...doc }) // insertOne adds _id to what it is given
      return doc
    },
    async getBoard(code) {
      return (await cols()).boards.findOne({ code }, NO_ID)
    },
    async updateBoard(code, patch) {
      return (await cols()).boards.findOneAndUpdate({ code }, { $set: boardPatch(patch), $inc: { rev: 1 } }, { returnDocument: 'after', ...NO_ID }) // $inc: atomic, and creates rev on boards made before it existed
    },
    async casBoard(code, rev, patch) {
      const filter = rev === 0 ? { code, $or: [{ rev: 0 }, { rev: { $exists: false } }] } : { code, rev }
      return (await cols()).boards.findOneAndUpdate(filter, { $set: boardPatch(patch), $inc: { rev: 1 } }, { returnDocument: 'after', ...NO_ID })
    },
    async claimSummary(code, { now = Date.now(), staleMs, autoFor } = {}) {
      const filter = { code, $or: [{ summaryState: { $ne: 'generating' } }, { summaryStartedAt: { $lte: now - staleMs } }] }
      if (autoFor !== undefined) Object.assign(filter, { status: 'closed', closedAt: autoFor, autoSummaryFor: { $ne: autoFor } })
      const set = { summaryState: 'generating', summaryStartedAt: now, summaryError: null, updatedAt: Date.now(), ...(autoFor !== undefined && { autoSummaryFor: autoFor }) }
      return (await cols()).boards.findOneAndUpdate(filter, { $set: set, $inc: { rev: 1 } }, { returnDocument: 'after', ...NO_ID })
    },
    async claimThemes(code, { now = Date.now(), staleMs } = {}) {
      const filter = { code, $or: [{ themesState: { $ne: 'generating' } }, { themesStartedAt: { $lte: now - staleMs } }] }
      return (await cols()).boards.findOneAndUpdate(filter, { $set: { themesState: 'generating', themesStartedAt: now, updatedAt: Date.now() }, $inc: { rev: 1 } }, { returnDocument: 'after', ...NO_ID })
    },
    async deleteBoard(code) {
      const { boards, items, people, participants } = await cols()
      await Promise.all([boards.deleteOne({ code }), items.deleteMany({ boardCode: code }), people.deleteMany({ boardCode: code }), participants.deleteMany({ boardCode: code })])
    },
    async getParticipant(code, uid) {
      return (await cols()).participants.findOne({ boardCode: code, uid }, NO_ID)
    },
    // Insert-if-absent for the uid: an upsert that only sets fields on insert. Two requests racing to create the same
    // uid can both reach the insert; the loser's duplicate-key error is turned into a read of the winner's record.
    // A duplicate on the NAME index (another uid has it) is rethrown for the caller to turn into a 409.
    async joinParticipant(code, uid, persona) {
      const { participants } = await cols()
      const { boardCode, uid: _uid, ...fields } = participantDoc(code, uid, persona) // eslint-disable-line no-unused-vars
      try {
        await participants.updateOne({ boardCode: code, uid }, { $setOnInsert: fields }, { upsert: true })
      } catch (e) {
        if (e?.code !== 11000) throw e
        const winner = await participants.findOne({ boardCode: code, uid }, NO_ID)
        if (!winner) throw e
        return winner
      }
      return participants.findOne({ boardCode: code, uid }, NO_ID)
    },
    // The authored-items check and the update are two steps (no multi-document transaction): an item added in
    // between can slip past the lock, which only means one persona change on a board where the author has just posted.
    async updateParticipant(code, uid, persona, { lockWhenAuthored = true } = {}) {
      const { participants, items } = await cols()
      if (lockWhenAuthored && (await items.countDocuments({ boardCode: code, authorUid: uid }, { limit: 1 })) > 0) throw lockedError()
      return participants.findOneAndUpdate({ boardCode: code, uid }, { $set: personaFields(persona, Date.now()) }, { returnDocument: 'after', ...NO_ID })
    },
    async listParticipants(code) {
      return (await cols()).participants.find({ boardCode: code }, NO_ID).sort({ joinedAt: 1, uid: 1 }).toArray()
    },
    async countAuthoredItems(code, uid) {
      return (await cols()).items.countDocuments({ boardCode: code, authorUid: uid })
    },
    // Mongo twin of the memory method: ban first (so every later request is refused), then drop the row, then tombstone the
    // person's live items one by one with the same guard as clearVotes.
    async removeParticipant(code, id, { deleteItems = false } = {}) {
      const { boards, items, participants } = await cols()
      const board = await boards.findOne({ code }, NO_ID)
      if (!board) return null
      const wasBanned = (board.bans ?? []).includes(id)
      if (!wasBanned) {
        const res = await boards.updateOne({ code, [`bans.${MAX_BANS - 1}`]: { $exists: false } }, { $addToSet: { bans: id } })
        if (!res || res.matchedCount === 0) throw bansFullError()
      }
      const del = await participants.deleteOne({ boardCode: code, uid: id })
      const existed = (del?.deletedCount ?? 0) > 0
      const changed = []
      if (deleteItems) {
        const mine = await items.find({ boardCode: code, authorUid: id, deleted: false }, NO_ID).sort({ updatedAt: 1 }).toArray()
        let last = board.lastTs || 0
        const floor = () => (last = Math.max(Date.now(), last + 1))
        for (const doc of mine) {
          if (doc.anon === true) continue // an anonymous note stays (see planTombstones)
          const r = await guardedUpdate(items, code, doc, (cur) => (cur.deleted ? null : structuredClone(TOMBSTONE_FIELDS)), floor)
          if (r.changed) { changed.push(r.doc); last = Math.max(last, r.doc.updatedAt) }
        }
        if (changed.length) await boards.updateOne({ code }, { $max: { lastTs: last, updatedAt: last } })
      }
      return { existed, wasBanned, changed }
    },
    async listItems(code) {
      return (await cols()).items.find({ boardCode: code, deleted: false }, NO_ID).sort({ updatedAt: 1 }).toArray()
    },
    async itemsSince(code, t) {
      return (await cols()).items.find({ boardCode: code, updatedAt: { $gt: t } }, NO_ID).sort({ updatedAt: 1 }).toArray()
    },
    async applyOps(code, ops, actor) {
      const { boards, items } = await cols()
      const board = await boards.findOne({ code }, NO_ID)
      if (!board) return rejectAll(ops, 'Board not found')
      const ids = [...new Set(ops.map((o) => o.id))]
      const existing = new Map((await items.find({ boardCode: code, id: { $in: ids } }, NO_ID).toArray()).map((i) => [i.id, i]))
      const live = ops.some((o) => o.op === 'add') ? await items.countDocuments({ boardCode: code, deleted: false }) : 0
      // The vote budget spans the whole board, not just the items in this batch.
      const used = ops.some((o) => o.op === 'vote') ? await items.countDocuments({ boardCode: code, deleted: false, votes: actor.uid }) : undefined
      // The board's media budget and document cap are only counted when the batch could grow them.
      const heavy = ops.some((o) => (o.op === 'add' && mediaSize(o.item)) || (o.op === 'update' && o.patch.data && mediaSize({ data: o.patch.data })))
      const media = heavy ? await mediaBytesOf(items, code) : undefined
      const docs = ops.some((o) => o.op === 'add') ? await items.countDocuments({ boardCode: code }) : undefined
      // Retro boards cap live actions board-wide, which the touched items alone cannot show.
      const acts = board.type === 'retro' && board.retro && ops.some((o) => o.op === 'add' && o.item?.kind === 'action') ? await items.countDocuments({ boardCode: code, deleted: false, kind: 'action' }) : undefined
      const plan = planOps(board, existing, ops, actor, Date.now(), live, used, media, docs, acts)
      if (plan.writes.length) {
        await items.bulkWrite(plan.writes.map(({ item }) => ({ replaceOne: { filter: { boardCode: code, id: item.id }, replacement: item, upsert: true } })))
        await boards.updateOne({ code }, { $max: { lastTs: plan.lastTs, updatedAt: plan.lastTs } })
      }
      // The vote cap is check-then-act: parallel requests from one person can each count the same `used` and all pass. So
      // after writing, count again; if the person is over their cap, take back exactly the votes THIS request added and
      // refuse those ops ("No votes left"). Under a true race both requests may be refused: that is the safe side.
      const added = plan.writes.map((w) => w.item).filter((i) => i.votes?.includes(actor.uid) && !existing.get(i.id)?.votes?.includes(actor.uid))
      if (added.length && (await items.countDocuments({ boardCode: code, deleted: false, votes: actor.uid })) > (board.vote?.perPerson ?? DEFAULT_PER_PERSON)) {
        let last = plan.lastTs
        const floor = () => (last = Math.max(Date.now(), last + 1))
        const undone = new Map()
        for (const item of added) {
          const r = await guardedUpdate(items, code, item, (cur) => (cur.votes?.includes(actor.uid) ? { votes: cur.votes.filter((u) => u !== actor.uid) } : null), floor)
          if (r.skipped) console.error('retrospace: could not take back an over-cap vote on', item.id) // stays applied: the answer must match the database
          else { undone.set(item.id, r.doc); last = Math.max(last, r.doc.updatedAt) }
        }
        if (undone.size) {
          await boards.updateOne({ code }, { $max: { lastTs: last, updatedAt: last } })
          return {
            applied: [...plan.applied.filter((i) => !undone.has(i.id)), ...undone.values()],
            rejected: [...plan.rejected, ...[...undone.keys()].map((id) => ({ id, error: 'No votes left' }))],
          }
        }
      }
      return { applied: plan.applied, rejected: plan.rejected }
    },
    // Owner reset of a vote round, item by item with the guard above (see guardedUpdate). An item that kept changing under
    // us is skipped and counted. -> { changed: [docs], skipped }
    async clearVotes(code) {
      const { boards, items } = await cols()
      const board = await boards.findOne({ code }, NO_ID)
      if (!board) return { changed: [], skipped: 0 }
      const voted = await items.find({ boardCode: code, deleted: false, votes: { $exists: true, $ne: [] } }, NO_ID).sort({ updatedAt: 1 }).toArray()
      let last = board.lastTs || 0
      const floor = () => (last = Math.max(Date.now(), last + 1))
      const changed = []
      let skipped = 0
      for (const doc of voted) {
        const r = await guardedUpdate(items, code, doc, (cur) => (!cur.deleted && cur.votes?.length ? { votes: [] } : null), floor)
        if (r.skipped) skipped++
        else if (r.changed) { changed.push(r.doc); last = Math.max(last, r.doc.updatedAt) }
      }
      if (changed.length) await boards.updateOne({ code }, { $max: { lastTs: last, updatedAt: last } })
      return { changed, skipped }
    },
    async listPeople(code) {
      return (await cols()).people.find({ boardCode: code }, NO_ID).sort({ _id: 1 }).toArray()
    },
    async savePeople(code, people) {
      const { people: col } = await cols()
      const docs = withBoardCode(code, people)
      await col.deleteMany({ boardCode: code })
      if (docs.length) await col.insertMany(docs.map((d) => ({ ...d })))
      return docs
    },
    async listBoardsByOwner(ownerId) {
      return (await cols()).boards.find({ ownerId }, NO_ID).sort({ updatedAt: -1 }).toArray()
    },
    async createUser(user) {
      const { users } = await cols()
      const doc = { ...user, email: normEmail(user.email) }
      await users.insertOne({ ...doc }) // a duplicate email throws E11000 (code 11000) from the unique index
      return doc
    },
    async getUserByEmail(email) {
      return (await cols()).users.findOne({ email: normEmail(email) }, NO_ID)
    },
    async getUserById(id) {
      return (await cols()).users.findOne({ id }, NO_ID)
    },
    // expiresAt is a Date in Mongo (a TTL index only works on dates); callers always see milliseconds.
    async createTemplate(tpl) {
      const templates = await tplCol()
      const doc = { ...tpl, nameLower: tpl.name.toLowerCase() }
      await templates.insertOne({ ...doc }) // E11000 when the owner already has that name
      return doc
    },
    async listTemplates(ownerId) {
      return (await tplCol()).find({ ownerId }, NO_ID).sort({ createdAt: -1 }).toArray()
    },
    async deleteTemplate(ownerId, id) {
      return (await (await tplCol()).deleteOne({ ownerId, id })).deletedCount > 0
    },
    async createSession(session) {
      const { sessions } = await cols()
      await sessions.insertOne({ ...session, expiresAt: new Date(session.expiresAt) })
    },
    async getSessionByTokenHash(h, now = Date.now()) {
      const s = await (await cols()).sessions.findOne({ tokenHash: h, expiresAt: { $gt: new Date(now) } }, NO_ID)
      return s ? { ...s, expiresAt: s.expiresAt.getTime() } : null
    },
    async deleteSession(h) {
      await (await cols()).sessions.deleteOne({ tokenHash: h })
    },
    async touchSession(h, now = Date.now()) {
      await (await cols()).sessions.updateOne({ tokenHash: h }, { $set: { lastSeenAt: now } })
    },
    async deleteSessionsByUser(userId) {
      await (await cols()).sessions.deleteMany({ userId })
    },
    async deleteTemplatesByOwner(ownerId) {
      await (await tplCol()).deleteMany({ ownerId })
    },
    async deleteUser(id) {
      return ((await (await cols()).users.deleteOne({ id })).deletedCount ?? 0) > 0
    },
  }
}

let singleton
export function getStore() {
  if (!singleton) {
    singleton = envValue('MONGODB_URI')
      ? createMongoStore(() => getMongo(), dbName())
      : createMemoryStore((globalThis._kmMem ??= newMemState()))
  }
  return singleton
}
