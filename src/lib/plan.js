import { validateItem } from './validate.js'
import { DEFAULT_PER_PERSON, isVotable } from './vote.js'
import { retroAllows } from './retro.js'
import { resolveAnon } from './anon.js'

export const MAX_ITEMS = 2000
export const MAX_DOCS = 4000 // live + deleted documents of one board (a tombstone is small, but not free)
export const MAX_MEDIA = 3 * 1024 * 1024 // bytes of data: URLs one board may hold (a snapshot must fit one Vercel response)

// Which item kinds each board type may hold. A kind with no renderer for the board would break it for everyone, so the
// server refuses the rest, whatever the validator accepts. Unknown types fall back to the workshop set.
const CANVAS_KINDS = ['note', 'text', 'shape', 'connector', 'frame', 'image']
export const ALLOWED_KINDS = {
  workshop: CANVAS_KINDS,
  retro: [...CANVAS_KINDS, 'action', 'theme', 'topic'],
  celebration: [...CANVAS_KINDS, 'card'],
  wall: ['shoutout', 'note', 'text'],
}
export const allowedKinds = (type) => ALLOWED_KINDS[type] ?? CANVAS_KINDS

const HEAVY = ['src', 'gif', 'image']
// Bytes of data: URLs an item carries (links cost nothing here).
export const mediaSize = (item) => {
  let n = 0
  for (const k of HEAVY) { const v = item?.data?.[k]; if (typeof v === 'string' && v.startsWith('data:')) n += v.length }
  return n
}
// A deleted item keeps only what the clients and the id/ordering rules need: its heavy and free-form data goes.
const tombstone = (item) => ({ ...item, data: {}, votes: [], reactions: {}, deleted: true })
const PATCH_KEYS = ['x', 'y', 'w', 'h', 'z', 'rot']

// Pure rules for a batch of already-validated ops (see validateOp), shared by the memory and Mongo stores.
// `items` is a Map id -> stored item covering at least every id the ops touch (tombstones included).
// `liveCount` is the board's non-deleted item count; derived from `items` when omitted.
// `votesUsed` is how many live items on the whole board the actor has voted on before this batch (the vote budget is
// per person across ALL items, which a store that loaded only the touched items cannot see); derived from `items` when omitted.
// `actor` = { uid, name, avatar, isOwner }: the name and avatar are stamped from the participant record by the route.
// Nothing is mutated; the caller persists `writes` (final state per item) and `lastTs`.
export function planOps(board, items, ops, actor, now, liveCount, votesUsed, mediaBytes, docCount, actionsLive) {
  const work = new Map() // id -> { item, isNew }: this batch's view, so later ops see earlier ones
  const applied = []
  const rejected = []
  let live = liveCount ?? [...items.values()].filter((i) => !i.deleted).length
  let last = board.lastTs || 0
  let actions = actionsLive ?? [...items.values()].filter((i) => !i.deleted && i.kind === 'action').length // live retro actions (the cap is board-wide)
  let used = null // the actor's votes in use, kept up to date as the batch toggles votes and deletes items
  const budget = () => (used ??= votesUsed ?? [...items.values()].filter((i) => !i.deleted && i.votes?.includes(actor.uid)).length)

  let media = mediaBytes ?? [...items.values()].reduce((n, i) => (i.deleted ? n : n + mediaSize(i)), 0) // data: bytes in live items
  let docs = docCount ?? items.size
  const kinds = allowedKinds(board.type)

  const tick = () => (last = Math.max(now, last + 1))
  const current = (id) => work.get(id)?.item ?? items.get(id)
  const commit = (item, isNew = false) => {
    work.set(item.id, { item, isNew: work.get(item.id)?.isNew ?? isNew })
    applied.push(item)
  }

  for (const o of ops) {
    const fail = (error) => rejected.push({ id: o.id, error })
    if (!actor.isOwner && (board.status === 'closed' || board.locked)) { fail(board.status === 'closed' ? 'Board is closed' : 'Board is locked'); continue }
    const stored = current(o.id)
    // Retro boards with a workflow: what each stage allows (the owner is exempt; see retro.js).
    const gate = retroAllows(board, o, o.op === 'add' ? o.item : stored && !stored.deleted ? stored : undefined, actor, actions)
    if (!gate.ok) { fail(gate.error); continue }

    if (o.op === 'add') {
      if (stored) { fail('Item already exists'); continue }
      if (!kinds.includes(o.item.kind)) { fail(`A ${o.item.kind} can't be added to this board`); continue }
      const anon = resolveAnon(board, o.item, actor.isOwner)
      if (anon.error) { fail(anon.error); continue } // before any counter moves, so a refused add leaves the batch's counts alone
      if (live >= MAX_ITEMS || docs >= MAX_DOCS) { fail('Board is full'); continue }
      const size = mediaSize(o.item)
      if (media + size > MAX_MEDIA) { fail('This board has reached its picture limit'); continue }
      media += size
      docs++
      live++
      if (o.item.kind === 'action') actions++
      const { anon: _anon, ...base } = o.item // eslint-disable-line no-unused-vars
      commit({
        ...base,
        ...(anon.anon && { anon: true }),
        boardCode: board.code,
        authorUid: actor.uid,
        authorName: actor.name,
        ...(actor.avatar && { authorAvatar: actor.avatar }),
        votes: [],
        reactions: {},
        deleted: false,
        updatedAt: tick(),
      }, true)
      continue
    }

    if (!stored || stored.deleted) { fail('Item not found'); continue }
    const mayEdit = actor.isOwner || stored.authorUid === actor.uid

    switch (o.op) {
      case 'update': {
        if (!mayEdit) { fail('Not allowed'); break }
        // Patches carry no kind, so the kind-specific shape/size rules run on the merged item.
        const merged = { ...stored, data: { ...stored.data, ...o.patch.data } }
        for (const k of PATCH_KEYS) if (o.patch[k] !== undefined) merged[k] = o.patch[k]
        const r = validateItem(merged)
        if (!r.ok) { fail(r.error); break }
        const grow = mediaSize(r.item) - mediaSize(stored)
        if (grow > 0 && media + grow > MAX_MEDIA) { fail('This board has reached its picture limit'); break }
        media += grow
        commit({ ...stored, ...r.item, updatedAt: tick() })
        break
      }
      case 'delete':
        if (!mayEdit) { fail('Not allowed'); break }
        live--
        if (stored.kind === 'action') actions--
        if (stored.votes?.includes(actor.uid)) budget(), used-- // its vote goes with it, freeing a slot
        media -= mediaSize(stored)
        commit({ ...tombstone(stored), updatedAt: tick() })
        break
      case 'vote': {
        // Frames and connectors are not votable. Voting must be open (the owner included). Taking a vote back is always
        // fine, even when perPerson was lowered below what someone already holds; adding one needs a slot.
        if (!isVotable(stored)) { fail('Can\'t vote on this'); break }
        if (!board.vote?.active) { fail('Voting is not open'); break }
        if (stored.votes.includes(actor.uid)) used = budget() - 1
        else if (budget() >= (board.vote.perPerson ?? DEFAULT_PER_PERSON)) { fail('No votes left'); break }
        else used = budget() + 1
        commit({ ...stored, votes: toggle(stored.votes, actor.uid), updatedAt: tick() })
        break
      }
      case 'react': {
        const reactions = { ...stored.reactions }
        const uids = toggle(reactions[o.emoji] || [], actor.uid)
        if (uids.length) reactions[o.emoji] = uids
        else delete reactions[o.emoji]
        commit({ ...stored, reactions, updatedAt: tick() })
        break
      }
      default:
        fail('unknown op')
    }
  }

  return { applied, rejected, writes: [...work.values()], lastTs: last }
}

const toggle = (list, uid) => (list.includes(uid) ? list.filter((u) => u !== uid) : [...list, uid])

// Clears the votes of every live item that has any: -> { changed, lastTs }, `changed` being the new item docs with
// strictly increasing updatedAt, each above both board.lastTs and the item's own previous stamp (pollers and the
// stream both see them, and a client holding the newest version never discards the reset). Nothing is mutated.
export function planClearVotes(board, items, now) {
  let last = board.lastTs || 0
  const changed = []
  for (const item of items) {
    if (item.deleted || !item.votes?.length) continue
    last = Math.max(now, last + 1, (item.updatedAt || 0) + 1)
    changed.push({ ...item, votes: [], updatedAt: last })
  }
  return { changed, lastTs: changed.length ? last : board.lastTs || 0 }
}
