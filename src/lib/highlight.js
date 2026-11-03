// Highlights: an item the owner or its author marked so it stands out (`hl: true` on the item, like `votes`). Pure; shared by the
// server rules (plan.js) and the board UI.
import { isVotable } from './vote.js'

export const NOT_HIGHLIGHTABLE = ['connector', 'stroke'] // a line, or a stroke that already is a highlight, is not something to point at
export const isHighlightable = (item) => Boolean(item) && !item.deleted && !NOT_HIGHLIGHTABLE.includes(item.kind)
export const isHighlighted = (item) => Boolean(item) && !item.deleted && item.hl === true

// What goes on the Highlights list, from a board's items: the highlighted ones, then the most-voted of the rest, then the
// follow-up actions. Raw items in, raw items out (callers turn them into text). Each list is most voted first, then in reading
// order (top to bottom, left to right). An action sits only under actions; a connector or frame is never listed.
export const TOP_VOTED = 5

export function highlightGroups(items, { top = TOP_VOTED } = {}) {
  const live = (items ?? []).filter((i) => i && !i.deleted)
  const votes = (i) => (Array.isArray(i.votes) ? i.votes.length : 0)
  const order = (a, b) => votes(b) - votes(a) || (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)
  const highlighted = live.filter((i) => isHighlighted(i) && isHighlightable(i) && i.kind !== 'action').sort(order)
  const taken = new Set(highlighted.map((i) => i.id))
  const mostVoted = live.filter((i) => !taken.has(i.id) && isVotable(i) && votes(i) > 0).sort(order).slice(0, top)
  const actions = live.filter((i) => i.kind === 'action').sort(order)
  return { highlighted, top: mostVoted, actions }
}

// The Highlights list as plain text, for pasting into a chat or a sprint doc. `h` is the print model's `highlights`
// ({ highlighted, top, actions } of rows { text, votes }), or null.
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`
export function highlightsText(title, h) {
  const lines = [`Highlights${title ? ` - ${title}` : ''}`]
  const block = (heading, list, mark) => {
    if (!list?.length) return
    lines.push('', heading)
    for (const r of list) lines.push(`${mark} ${r.text.replace(/\s*\n\s*/g, ' ')}${r.votes > 0 ? ` (${plural(r.votes, 'vote')})` : ''}`)
  }
  block('Highlighted', h?.highlighted, '*')
  block('Most voted', h?.top, '-')
  block('Action items', h?.actions, '[ ]')
  if (lines.length === 1) lines.push('', 'Nothing is highlighted yet.')
  return lines.join('\n')
}
