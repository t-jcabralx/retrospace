// Pure rules for the owner's tools (Task 17). Shared by the memory and Mongo stores.
import { viewerItems } from './anon.js'
export const MAX_BANS = 500
export const bansFullError = () => Object.assign(new Error('Too many people have been removed from this board'), { code: 'BANS_FULL' })

// What plan.js's own delete leaves of an item (its tombstone): heavy and free-form data go, the id/ordering stay. Kept equal to
// plan.js by a test (test/owner-tools-server.test.mjs), because plan.js is shared and not exported from there.
export const TOMBSTONE_FIELDS = { data: {}, votes: [], reactions: {}, deleted: true }

// Tombstones every live item authored by the public id `id`: -> { changed, lastTs }. Each new updatedAt is strictly above
// the board's lastTs, the previous one and the item's own stamp, so peers and pollers never discard the deletion.
export function planTombstones(board, items, id, now) {
  let last = board.lastTs || 0
  const changed = []
  for (const item of items) {
    if (item.deleted || item.authorUid !== id || item.anon === true) continue // an anonymous note stays: its vanishing would name its author
    last = Math.max(now, last + 1, (item.updatedAt || 0) + 1)
    changed.push({ ...item, ...structuredClone(TOMBSTONE_FIELDS), updatedAt: last })
  }
  return { changed, lastTs: changed.length ? last : board.lastTs || 0 }
}

// The two envelopes a removal publishes on the board channel. Both carry only per-board PUBLIC ids (`from` is the owner's,
// `id` the removed person's) and tombstones: never a cookie uid, an e-mail or a ban list. Clients whose own id equals `id`
// stop syncing and show the "removed" panel; everybody else drops the person from the people list.
export const kickedEnvelope = (ownerPublicId, id) => ({ t: 'kicked', from: ownerPublicId, id })
export const tombstonesEnvelope = (ownerPublicId, changed) => ({ t: 'ops', from: ownerPublicId, ops: viewerItems(changed) }) // anon tombstones lose their author fields too
