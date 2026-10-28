// Anonymous notes. Pure, browser-safe. An item with `anon: true` never reveals its author to ANYONE (guests and owner
// alike): the store keeps the real authorUid for permission checks, but every transport serializes items through
// viewerItem(s) below, which swaps the author fields for a fixed marker. Only the author's own response carries
// `mine: true`, so their UI knows it may edit or delete. Anything that serializes items (snapshot, /since, reveal, the
// ops response and the stream envelopes, exports) must go through here.
export const ANON_KINDS = ['note', 'text', 'shape', 'image', 'card']
export const ANON_MODES = ['optional', 'always', 'never']
export const ANON_UID = 'anon'
export const ANON_NAME = 'Anonymous'

// 'optional' on retro boards unless the owner chose otherwise; every other board type is always 'never'.
export function anonModeOf(board) {
  if (board?.type !== 'retro') return 'never'
  return ANON_MODES.includes(board.anonymousNotes) ? board.anonymousNotes : 'optional'
}

// -> { anon: boolean } or { error }: what an added item becomes under the board's mode. `always` forces it for everyone
// but the owner (the owner's own notes follow the owner's choice); `never` refuses it.
export function resolveAnon(board, item, isOwner) {
  const mode = anonModeOf(board)
  if (item.anon === true && mode === 'never') return { error: 'Anonymous notes are off on this board' }
  if (!ANON_KINDS.includes(item.kind)) return { anon: false }
  return { anon: item.anon === true || (mode === 'always' && !isOwner) }
}

// One item as `viewerId` (the viewer's per-board public id, or null for a broadcast) may see it. Returns a copy.
export function viewerItem(item, { viewerId = null } = {}) {
  if (!item || typeof item !== 'object') return item
  const { mine, ...plain } = item // eslint-disable-line no-unused-vars
  if (item.anon !== true) return plain
  const { authorUid, authorName, authorAvatar, ...rest } = plain // eslint-disable-line no-unused-vars
  return { ...rest, authorUid: ANON_UID, authorName: ANON_NAME, authorAvatar: null, ...(viewerId && authorUid === viewerId && { mine: true }) }
}

export const viewerItems = (items, ctx) => (Array.isArray(items) ? items.map((i) => viewerItem(i, ctx)) : items)

// A stream envelope { t: 'ops', from, cid, ops } -> the envelopes to publish. Items that are not anonymous keep `from`
// and `cid`; any envelope with an anonymous item is sent WITHOUT them (`from` becomes a fixed marker), since the sender
// of an add or edit would otherwise name the author. Nothing in it is per-viewer: no `mine`.
export function opsEnvelopes(env) {
  const ops = viewerItems(env.ops, { viewerId: null })
  const anon = ops.filter((i) => i.anon === true)
  if (!anon.length) return [{ ...env, ops }]
  const { from, cid, ...rest } = env // eslint-disable-line no-unused-vars
  const plain = ops.filter((i) => i.anon !== true)
  return [...(plain.length ? [{ ...env, ops: plain }] : []), { ...rest, from: ANON_UID, ops: anon }]
}

// The ids of `selection` that may be announced to other people's screens as an outline. An anonymous note is left out:
// the outline travels with the selector's public id and name tag, which would name the author. The local selection is
// untouched. (A live cursor resting near a note stays a weaker signal that this cannot remove.)
export function selectionForPresence(selection, itemsById) {
  return [...selection].filter((id) => itemsById.get(id)?.anon !== true)
}

// Whether a note the viewer is about to add is sent as anonymous: `always` posts anonymously for everyone (the owner
// included, as the locked notice says), `optional` follows the toggle, `never` and any non-note kind never. The server
// still decides what the board's mode allows.
export function addsAnonymously(mode, toggleOn, kind) {
  if (kind !== 'note') return false
  return mode === 'always' || (mode === 'optional' && Boolean(toggleOn))
}
