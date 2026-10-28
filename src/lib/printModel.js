// The print view's document, as plain data. Pure: board, items and participants in (one consistent snapshot, as the board API
// serves it to this viewer), the document out. Nothing the viewer may not see is read here: only the board's title, type and
// dates, a SHARED summary, live items and, when asked for by the owner, the names people chose. A theme's source notes are
// looked up among the live notes, so a deleted note simply drops out of the list.
import { categorizeRaw, actionLine } from './ai/input.js'

export const TYPE_LABELS = { retro: 'Retrospective', workshop: 'Workshop', celebration: 'Celebration', wall: 'Team wall' }
// Control characters (except line feed), line/paragraph separators, zero-width and bidi marks.
// code points, written as numbers so no invisible character sits in this file
const hidden = (c) => c <= 9 || (c >= 11 && c <= 31) || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff
const MEDIA_URL = /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i

export const printable = (v) => (typeof v === 'string' ? Array.from(v.replace(/\r\n?/g, '\n')).filter((ch) => !hidden(ch.codePointAt(0))).join('').replace(/\n{3,}/g, '\n\n').trim() : '')
const day = (t) => (Number.isFinite(Number(t)) && Number(t) > 0 ? new Date(Number(t)).toISOString().slice(0, 10) : null)
const votesOf = (it) => (Array.isArray(it?.votes) ? it.votes.length : 0)
const textOf = (it) => printable(it.kind === 'action' ? actionLine(it.data) : it.kind === 'card' || it.kind === 'shoutout' ? it.data?.message : it.data?.text)
const mediaOf = (it) => {
  const src = it.data?.image ?? it.data?.gif
  return typeof src === 'string' && MEDIA_URL.test(src) ? { type: it.data?.image ? 'photo' : 'gif', src } : null
}

// options: { authors: false, isOwner: false, now }. Author names need BOTH `authors` and `isOwner`: a guest never gets them.
export function buildPrintModel(board, items, participants = [], { authors = false, isOwner = false, now = Date.now() } = {}) {
  const live = (items ?? []).filter((i) => i && !i.deleted)
  const showAuthors = Boolean(authors && isOwner)
  const names = new Map((participants ?? []).map((p) => [p.uid, printable(p.name)]))
  const authorOf = (it) => (showAuthors && it.anon !== true ? names.get(it.authorUid) || printable(it.authorName) || null : null)
  const byId = new Map(live.map((i) => [i.id, i]))
  const type = board?.type
  const rows = categorizeRaw(live.filter((i) => i.kind !== 'theme')) // reading order: column left to right, top to bottom

  const make = (it) => {
    const base = { id: it.id, kind: it.kind, text: textOf(it), votes: votesOf(it) }
    const author = authorOf(it)
    if (author) base.author = author
    if (it.kind === 'card') return { ...base, signer: printable(it.data?.signer), color: it.data?.color ?? null, media: mediaOf(it) }
    if (it.kind === 'shoutout') return { ...base, to: printable(it.data?.toName), badge: printable(it.data?.badge) }
    return base
  }

  const sections = []
  const section = (title) => {
    let s = sections.find((x) => x.title === title)
    if (!s) { s = { title, items: [] }; sections.push(s) }
    return s
  }
  for (const r of rows) {
    const it = byId.get(r.id)
    if (it.kind === 'card' && type === 'celebration') section('Cards').items.push(make(it))
    else if (it.kind === 'shoutout') section(printable(it.data?.badge) || 'Shoutouts').items.push(make(it))
    else section(r.category).items.push(make(it))
  }
  // Most voted first inside a column (the stable sort keeps the reading order among equals); cards stay in reading order.
  for (const s of sections) if (s.title !== 'Cards') s.items = s.items.map((x, n) => [x, n]).sort((a, b) => b[0].votes - a[0].votes || a[1] - b[1]).map(([x]) => x)

  const themes = live
    .filter((i) => i.kind === 'theme')
    .map((t, n) => {
      const notes = []
      for (const id of Array.isArray(t.data?.noteIds) ? t.data.noteIds : []) {
        const note = byId.get(id)
        if (note && note.kind === 'note') notes.push({ id, text: textOf(note) })
      }
      return { id: t.id, title: printable(t.data?.title), votes: votesOf(t), notes, n }
    })
    .sort((a, b) => b.votes - a.votes || a.n - b.n)
    .map(({ n, ...t }) => t) // eslint-disable-line no-unused-vars

  const shared = board?.summary?.status === 'shared' && typeof board.summary.text === 'string' ? printable(board.summary.text) : ''
  const showVotes = live.some((i) => votesOf(i) > 0)
  return {
    cover: {
      title: printable(board?.title) || 'Untitled board',
      type: TYPE_LABELS[type] ?? 'Board',
      created: day(board?.createdAt),
      printed: day(now),
      participants: (participants ?? []).length,
    },
    showVotes,
    authors: showAuthors,
    summary: shared ? { text: shared, ai: board.summary.source === 'ai' } : null,
    themes,
    sections,
    empty: !sections.length && !themes.length && !shared,
  }
}

// What the print page does with the board API's answer. -> 'ready' | 'missing' | 'passcode' | 'revoked' | 'removed' | 'error'
export function printPhase(status, error) {
  if (status >= 200 && status < 300) return 'ready'
  if (status === 404) return 'missing'
  if (status === 401 && error === 'Passcode required') return 'passcode'
  if (status === 403 && error === 'This link was revoked') return 'revoked'
  if (status === 403 && error === 'You were removed from this board') return 'removed'
  return 'error'
}
