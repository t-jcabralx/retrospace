// Pure helpers for voting: how many votes a person has left, and the results once voting stops.
import { DEFAULT_PER_PERSON, isVotable } from '../lib/vote.js'

export function perPerson(board) {
  const n = board?.vote?.perPerson
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_PER_PERSON
}

export const voteCount = (item) => (Array.isArray(item?.votes) ? item.votes.length : 0)
export const votesUsed = (items, uid) => (uid ? items.filter((i) => i.votes?.includes(uid)).length : 0)
export const votesLeft = (board, items, uid) => Math.max(0, perPerson(board) - votesUsed(items, uid))
export const anyVotes = (items) => items.some((i) => isVotable(i) && voteCount(i) > 0)

// The leaders: up to `limit` places, but everybody tied with the last place stays in, so a tie is never cut in half.
// -> [{ id, item, count, rank }], best first (ties in id order); rank is 1, 2, 2, 4 style ("competition ranking").
export function topVoted(items, limit = 3) {
  const voted = (items ?? []).filter((i) => isVotable(i) && voteCount(i) > 0)
  voted.sort((a, b) => voteCount(b) - voteCount(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (!voted.length) return []
  const cut = voteCount(voted[Math.min(limit, voted.length) - 1])
  return voted.filter((i) => voteCount(i) >= cut).map((item) => ({
    id: item.id,
    item,
    count: voteCount(item),
    rank: 1 + voted.filter((o) => voteCount(o) > voteCount(item)).length,
  }))
}

// A short readable name for an item in a results list.
export function excerpt(item, max = 60) {
  const d = item?.data ?? {}
  const raw = item?.kind === 'frame' ? d.title : item?.kind === 'image' ? '' : d.text ?? d.message ?? d.title
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return item?.kind === 'image' ? 'Image' : item?.kind === 'frame' ? 'Untitled frame' : item?.kind === 'note' ? 'Empty note' : 'Empty item'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
