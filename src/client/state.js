// Pure board state: no React, no browser globals. The UI keeps this in a useReducer; undo/redo are plain
// functions because they must hand back the ops to send, which a reducer cannot.
//
// state = { board, viewer, people, participants, items: Map<id, item>, tombs: Map<id, updatedAt>, undo: [], redo: [], lastSeen }
// undo / redo entries are { ops: [...] }: the client ops that reverse (or repeat) one local action.

const PATCH_KEYS = ['x', 'y', 'w', 'h', 'z', 'rot']
const ITEM_FIELDS = ['id', 'kind', 'x', 'y', 'w', 'h', 'z', 'rot', 'data', 'anon']
const MAX_HISTORY = 100

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const maxUpdated = (items) => items.reduce((m, i) => Math.max(m, Number(i.updatedAt) || 0), 0)

// The board settings a 'board' action may change: the viewer-safe ones, each with the shape it must have. Anything else
// in the incoming board (code, type, lastTs, a stray ownerId...) is ignored, and `viewer` is never touched.
const isStr = (v) => typeof v === 'string'
const isBool = (v) => typeof v === 'boolean'
const BOARD_FIELDS = {
  title: isStr,
  theme: isObj,
  locked: isBool,
  status: (v) => v === 'open' || v === 'closed',
  revoked: isBool,
  recipient: (v) => v === null || isObj(v),
  revealAt: (v) => v === null || isStr(v),
  vote: isObj,
  timer: (v) => v === null || isObj(v),
  throwables: isObj,
  ai: isObj, // the owner's AI settings (guests never get this key)
  summary: (v) => v === null || isObj(v), // a shared summary for guests; the owner's own draft comes from the summary route
  summaryState: (v) => v === 'idle' || v === 'generating' || v === 'failed',
  retro: (v) => v === null || isObj(v), // the staged Retro workflow (stage bar, timers)
  anonymousNotes: (v) => v === 'optional' || v === 'always' || v === 'never',
  wheel: isObj, // the Event board's prize wheel (lists, current round, history)
  hasPasscode: isBool, // whether a passcode is set (the hash itself never reaches a client)
}

export function initialState(snapshot) {
  const items = new Map()
  for (const item of snapshot.items ?? []) items.set(item.id, item)
  return {
    board: snapshot.board,
    people: snapshot.people ?? [],
    participants: snapshot.participants ?? [], // [{ uid, name, avatar, kind }]: for avatars and presence
    viewer: snapshot.viewer ?? { role: 'guest' }, // who is looking, as the server decided (never from local storage)
    items,
    tombs: new Map(),
    drags: new Map(), // id -> { base: {x,y,w,h} the item had before a peer's live drag moved it, at } (temporary positions)
    undo: [],
    redo: [],
    lastSeen: Math.max(Number(snapshot.board?.lastTs) || 0, maxUpdated(snapshot.items ?? [])),
  }
}

// Ids are client-made. A deleted id stays on the server as a tombstone and cannot be added again,
// so re-adding (undo of a delete, redo of an add) uses a fresh id.
export function freshId() {
  const bytes = new Uint8Array(10)
  globalThis.crypto.getRandomValues(bytes)
  return 'i' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Applies one client op to `items` (a Map the caller owns) and returns the op that reverses it,
// or null when it had no effect. vote/react are server-only toggles: they are not applied optimistically.
function applyOp(items, op) {
  const id = op.id ?? op.item?.id
  const cur = items.get(id)
  switch (op.op) {
    case 'add': {
      if (cur || !isObj(op.item)) return null
      items.set(id, { deleted: false, updatedAt: 0, ...structuredClone(op.item), id })
      return { op: 'delete', id }
    }
    case 'update': {
      if (!cur || !isObj(op.patch)) return null
      const next = { ...cur }
      const patch = {}
      for (const k of PATCH_KEYS) {
        if (op.patch[k] === undefined) continue
        if (cur[k] !== undefined) patch[k] = cur[k]
        next[k] = op.patch[k]
      }
      if (isObj(op.patch.data)) {
        const data = {}
        // A key the item did not have cannot be un-set by a patch, so it is left out of the inverse.
        for (const k of Object.keys(op.patch.data)) if (cur.data && k in cur.data) data[k] = structuredClone(cur.data[k])
        if (Object.keys(data).length) patch.data = data
        next.data = { ...cur.data, ...op.patch.data }
      }
      items.set(id, next)
      return { op: 'update', id, patch }
    }
    case 'delete': {
      if (!cur) return null
      items.delete(id)
      const item = Object.fromEntries(ITEM_FIELDS.filter((k) => cur[k] !== undefined).map((k) => [k, structuredClone(cur[k])]))
      return { op: 'add', id, item }
    }
    default:
      return null
  }
}

// A slim doc (a stream broadcast of a move, vote, ...) leaves out the heavy data fields: they are taken from the item held.
const HEAVY = ['src', 'gif', 'image']
function withHeavy({ slim, ...doc }, cur) { // eslint-disable-line no-unused-vars
  const data = { ...doc.data }
  for (const k of HEAVY) if (cur?.data?.[k] !== undefined && data[k] === undefined) data[k] = cur.data[k]
  return { ...doc, data }
}

// Last-writer-wins by updatedAt. Server docs only: a doc with deleted:true removes the item and leaves a
// tombstone so an older doc arriving late cannot bring it back.
function merge(state, docs, advance) {
  const items = new Map(state.items)
  const tombs = new Map(state.tombs)
  let lastSeen = state.lastSeen
  for (const doc of docs ?? []) {
    if (!isObj(doc) || typeof doc.id !== 'string') continue
    if (doc.slim && !items.has(doc.id)) continue // a stream update without the heavy fields, for an item we do not hold: the next poll brings it whole
    const u = Number(doc.updatedAt) || 0
    if (advance) lastSeen = Math.max(lastSeen, u)
    const cur = items.get(doc.id)
    if (cur && u < cur.updatedAt) continue
    const tomb = tombs.get(doc.id)
    if (doc.deleted) {
      items.delete(doc.id)
      tombs.set(doc.id, Math.max(u, tomb ?? 0))
    } else if (tomb === undefined || u > tomb) {
      // A broadcast never says whose anonymous note it is (`mine` is per viewer): what this client already knows is kept.
      items.set(doc.id, { ...(doc.slim ? withHeavy(doc, cur) : doc), ...(doc.anon && doc.mine === undefined && cur?.mine && { mine: true }) })
    }
  }
  return { ...state, items, tombs, lastSeen }
}

// --- a peer's live drag: a temporary position, never stored, replaced by the real write that follows the drop ---
const FRAME = ['x', 'y', 'w', 'h']
const pick = (item) => Object.fromEntries(FRAME.filter((k) => Number.isFinite(item[k])).map((k) => [k, item[k]]))

// Who may move this item, as far as this client can tell: its author, or the board creator (the only signed-in account in a room).
// An anonymous note hides its author, so it cannot be checked here; the temporary position is never saved, only shown.
function mayDrag(state, item, from) {
  if (from === undefined || item.anon === true || !item.authorUid || item.authorUid === from) return true
  return state.participants.some((p) => p.uid === from && p.kind === 'account')
}

function peerDrag(state, list, now = Date.now(), from, q) {
  if (!Array.isArray(list) || !list.length) return state
  let items = null
  let drags = null
  for (const d of list) {
    if (!isObj(d) || typeof d.id !== 'string') continue
    const cur = (items ?? state.items).get(d.id)
    if (!cur || cur.deleted || !Number.isFinite(d.x) || !Number.isFinite(d.y) || !mayDrag(state, cur, from)) continue
    if (Number.isFinite(d.v) && d.v < (cur.updatedAt || 0)) continue // the item was saved again since this gesture began: the real write wins over a late step
    const prior = state.drags.get(d.id)
    if (Number.isFinite(q) && Number.isFinite(prior?.q) && q < prior.q) continue // a step that arrived after a newer one
    items ??= new Map(state.items)
    drags ??= new Map(state.drags)
    const held = drags.get(d.id)
    drags.set(d.id, { base: held?.base ?? pick(cur), at: now, ended: false, ...(Number.isFinite(q) && { q }) })
    items.set(d.id, { ...cur, x: d.x, y: d.y, ...(Number.isFinite(d.w) && d.w > 0 && { w: d.w }), ...(Number.isFinite(d.h) && d.h > 0 && { h: d.h }) })
  }
  return items ? { ...state, items, drags } : state
}

// The gesture ended: a cancelled one puts the items back at once; a dropped one keeps the position until the real write arrives.
function peerDragEnd(state, ids, cancel, now = Date.now()) {
  if (!Array.isArray(ids)) return state
  let items = null
  let drags = null
  for (const id of ids) {
    const held = state.drags.get(id)
    if (!held) continue
    drags ??= new Map(state.drags)
    if (cancel) {
      const cur = state.items.get(id)
      if (cur) { items ??= new Map(state.items); items.set(id, { ...cur, ...held.base }) }
      drags.delete(id)
    } else drags.set(id, { ...held, at: now, ended: true })
  }
  return drags ? { ...state, ...(items && { items }), drags } : state
}

// A drag nobody has updated for `after` ms (the sender left, or the write never came) goes back to where the item was.
function peerDragExpire(state, now = Date.now(), after = 10000) {
  // A dropped item waits `after` ms for its real write (a slow database can take seconds); a drag still in progress may pause
  // (the sender holds still), so it gets a little longer.
  const stale = [...state.drags].filter(([, h]) => now - h.at > (h.ended ? after : after * 1.5)).map(([id]) => id)
  return stale.length ? peerDragEnd(state, stale, true, now) : state
}

// Real data for an item replaces whatever temporary position a peer's drag gave it.
function clearDrags(state, docs) {
  if (!state.drags.size) return state
  let drags = null
  for (const d of docs ?? []) if (isObj(d) && state.drags.has(d.id)) { drags ??= new Map(state.drags); drags.delete(d.id) }
  return drags ? { ...state, drags } : state
}

const capped = (stack) => (stack.length > MAX_HISTORY ? stack.slice(stack.length - MAX_HISTORY) : stack)

export function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return initialState(action.snapshot)
    case 'local': {
      const items = new Map(state.items)
      const inverse = []
      for (const op of action.ops ?? []) {
        const inv = applyOp(items, op)
        if (inv) inverse.push(inv)
      }
      if (!inverse.length) return state
      if (action.track === false) return { ...state, items }
      return { ...state, items, undo: capped([...state.undo, { ops: inverse.reverse() }]), redo: [] }
    }
    case 'persona': { // this viewer's own persona was (re)saved: { persona, uid }
      const me = { uid: action.uid, name: action.persona.name, avatar: action.persona.avatar, kind: action.persona.kind }
      const others = state.participants.filter((p) => p.uid !== action.uid)
      return { ...state, viewer: { ...state.viewer, persona: action.persona }, participants: [...others, me] }
    }
    case 'forget-participant': // the owner removed this participant: drop them from the people list (their items stay or arrive as tombstones)
      return { ...state, participants: state.participants.filter((p) => p.uid !== action.uid) }
    case 'board': { // settings the owner changed (stream envelope or /since): only viewer-safe fields, and only a newer revision
      const b = action.board
      if (!state.board || !isObj(b)) return state
      const rev = Number(b.rev)
      const curRev = Number.isFinite(Number(state.board.rev)) ? Number(state.board.rev) : 0 // no rev yet = never changed
      const at = Number(b.updatedAt)
      if (Number.isFinite(rev)) {
        if (rev <= curRev) return state // older, or the same change again
      } else if (!Number.isFinite(at) || at < (Number(state.board.updatedAt) || 0)) {
        return state // no revisions to compare: fall back to the clock
      }
      const board = { ...state.board }
      if (Number.isFinite(at)) board.updatedAt = at
      if (Number.isFinite(rev)) board.rev = rev
      for (const [k, ok] of Object.entries(BOARD_FIELDS)) if (Object.hasOwn(b, k) && ok(b[k])) board[k] = structuredClone(b[k])
      return { ...state, board }
    }
    case 'votes-cleared': { // the owner reset the round and the server said so: no item keeps a vote (peers get the real docs over the stream)
      const items = new Map()
      for (const [id, item] of state.items) items.set(id, item.votes?.length ? { ...item, votes: [] } : item)
      return { ...state, items }
    }
    case 'peer-drag': return peerDrag(state, action.items, action.now, action.from, action.q)
    case 'peer-drag-end': return peerDragEnd(state, action.ids, action.cancel === true, action.now)
    case 'peer-drag-expire': return peerDragExpire(state, action.now, action.after)
    case 'vote-local': { // this viewer's own vote, shown at once; the server's answer replaces it (a refusal reloads the board)
      const cur = state.items.get(action.id)
      if (!cur || cur.deleted || typeof action.uid !== 'string') return state
      const votes = cur.votes ?? []
      const items = new Map(state.items)
      // One millisecond newer, so a stale copy of the item that is still on its way cannot undo it; the server's own answer is newer still.
      items.set(action.id, { ...cur, votes: votes.includes(action.uid) ? votes.filter((v) => v !== action.uid) : [...votes, action.uid], updatedAt: (cur.updatedAt || 0) + 1 })
      return { ...state, items }
    }
    case 'remote':
      return clearDrags(merge(state, action.items, true), action.items)
    case 'ack':
      // The author's own writes say nothing about peers' ops, so lastSeen stays where /since needs it.
      return clearDrags(merge(state, action.items, false), action.items)
    default:
      return state
  }
}

const remapId = (op, remap) => {
  const to = remap.get(op.id)
  if (to === undefined) return op
  return { ...op, id: to, ...(op.item && { item: { ...op.item, id: to } }) }
}
const remapStack = (stack, remap) => stack.map((e) => ({ ops: e.ops.map((o) => remapId(o, remap)) }))

// Pops the top entry of state[from], applies it, and pushes what reverses it onto state[to].
function step(state, from, to, newId) {
  if (!state[from].length) return { state, ops: [] }
  const entry = state[from].at(-1)
  const remap = new Map()
  for (const op of entry.ops) if (op.op === 'add') remap.set(op.id, newId())
  const rest = remap.size ? remapStack(state[from].slice(0, -1), remap) : state[from].slice(0, -1)
  const other = remap.size ? remapStack(state[to], remap) : state[to]

  const items = new Map(state.items)
  const ops = []
  const inverse = []
  for (const raw of entry.ops) {
    const op = remapId(raw, remap)
    const inv = applyOp(items, op)
    if (!inv) continue // its item was removed by someone else
    ops.push(op)
    inverse.push(inv)
  }
  return {
    state: { ...state, items, [from]: rest, [to]: inverse.length ? capped([...other, { ops: inverse.reverse() }]) : other },
    ops,
  }
}

// -> { state, ops }: send `ops` with sync.send(). Own actions only; peers' edits are never undone.
export const undo = (state, newId = freshId) => step(state, 'undo', 'redo', newId)
export const redo = (state, newId = freshId) => step(state, 'redo', 'undo', newId)

export function ordered(state) {
  return [...state.items.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
