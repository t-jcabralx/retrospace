'use client'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Note from './items/Note.jsx'
import Text from './items/Text.jsx'
import Shape from './items/Shape.jsx'
import Frame from './items/Frame.jsx'
import Image from './items/Image.jsx'
import Card from './items/Card.jsx'
import Shoutout from './items/Shoutout.jsx'
import Theme from './items/Theme.jsx'
import ActionCard from './items/ActionCard.jsx'
import Stroke from './items/Stroke.jsx'
import { noteColor } from './ops.js'
import { MAX_CARD_MESSAGE } from '../lib/validate.js'
import { VoteIcon } from './icons.jsx'
import { MARK_COLORS, normalizeMarks, rebaseMarks, applyMark, segments, charLength, toCharIndex } from '../lib/marks.js'

const BODY = { note: Note, text: Text, shape: Shape, frame: Frame, image: Image, card: Card, shoutout: Shoutout, theme: Theme, action: ActionCard, stroke: Stroke }
// Which data field the double-click editor changes.
const FIELD = { note: 'text', text: 'text', shape: 'text', frame: 'title', card: 'message', action: 'action' }
const MAX_LEN = { text: 2000, title: 80, message: MAX_CARD_MESSAGE, action: 200 }
const EDITOR_LABEL = { title: 'Frame title', message: 'Card message', action: 'Action' }
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNERS = ['nw', 'ne', 'se', 'sw']
const DOUBLE_TAP_MS = 350

// Required props: item, selected, editable, onChange(patch), onSelect(e).
// Extras the canvas adds: handles (draw resize handles), onResizeStart(e, handle), autoEdit/onEditEnd (open the
// editor right after creating an item), linking (connector tool source highlight), label (accessible name),
// onFocus (keyboard focus selects the item). Voting: votes (count), voted (the viewer's own), voting (show the vote
// button: voting is open and the viewer may vote) and onVote().
// Accessibility: each item is a focusable role="group" with an aria-label; the selected one carries
// aria-current="true" (aria-selected/pressed are not valid on a group).
function ItemView({ item, selected, editable, peerMoving = false, onChange, onDraft, onSelect, handles = false, onResizeStart, autoEdit = false, onEditEnd, linking = false, label, onFocus, votes = 0, voted = false, voting = false, onVote }) {
  const field = FIELD[item.kind]
  const canEdit = editable && Boolean(field)
  const [editing, setEditing] = useState(autoEdit && canEdit) // a just-created item opens in its first render
  const lastTap = useRef(0)
  const box = useRef(null)
  const Body = BODY[item.kind]

  useEffect(() => { if (autoEdit && canEdit) setEditing(true) }, [autoEdit, canEdit])
  useEffect(() => { if (!editable) setEditing(false) }, [editable])

  // `viaKey`: the editor was closed from the keyboard, so focus goes back to the item instead of falling to <body>.
  const done = (viaKey = false, value) => {
    setEditing(false)
    onEditEnd?.(value)
    if (viaKey) setTimeout(() => box.current?.focus({ preventScroll: true }), 0)
  }
  const needsText = item.kind === 'card' || item.kind === 'action'
  const marksOf = (m) => JSON.stringify(m ?? [])
  const commit = (value, viaKey, marks) => {
    // A card needs a message: an emptied editor keeps the old one rather than sending an update the server would refuse.
    const changed = value !== (item.data[field] ?? '') || (marks !== undefined && marksOf(marks) !== marksOf(item.data.marks))
    if (changed && !(needsText && !value.trim())) onChange({ data: { [field]: value, ...(marks !== undefined && { marks }) } })
    done(viaKey, value)
  }
  // Text is saved while it is typed, so a reload, a crash or a restart of the server in the middle of a sentence does not lose it.
  const saveDraft = onDraft && ((value, marks) => { if (!(needsText && !value.trim())) onDraft({ data: { [field]: value, ...(marks !== undefined && { marks }) } }) })

  const onPointerUp = (e) => { // double-tap: dblclick is not reliable for touch
    if (e.pointerType !== 'touch' || !canEdit) return
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) { lastTap.current = 0; setEditing(true) } else lastTap.current = now
  }

  const cls = ['bd-item', `bd-k-${item.kind}`, selected && 'is-selected', item.hl && 'is-highlighted', linking && 'is-linking', !editable && 'is-locked', peerMoving && 'is-peer-moving'].filter(Boolean).join(' ')
  const style = {
    width: item.w,
    height: item.h,
    transform: `translate(${item.x}px, ${item.y}px)${item.rot ? ` rotate(${item.rot}deg)` : ''}`,
    ...(item.kind === 'card' && { '--bd-card-bg': noteColor(item.data.color) }), // the editor paints over the card in its colour
  }
  const list = item.kind === 'image' ? CORNERS : HANDLES

  if (!Body) return null // a kind this build cannot draw is skipped, never a crash

  return (
    <div
      ref={box}
      className={cls}
      style={style}
      data-id={item.id}
      role="group"
      tabIndex={0}
      aria-label={votes > 0 ? `${label}, ${votes} ${votes === 1 ? 'vote' : 'votes'}` : label}
      aria-current={selected ? 'true' : undefined}
      onFocus={onFocus}
      onPointerDown={onSelect} onPointerUp={onPointerUp}
      onDoubleClick={() => canEdit && setEditing(true)}
    >
      <Body item={item} editing={editing} readOnly={!editable} />
      {item.hl && <span className="bd-hl-badge" role="img" aria-label="Highlighted">★</span>}
      {item.anon && <span className="bd-anon-badge" title="The author is hidden from everyone">Anonymous</span>}
      {voting ? (
        <button
          type="button"
          className={`bd-vote-btn${voted ? ' is-voted' : ''}`}
          aria-pressed={voted}
          aria-label={`Vote for ${label} (${votes} ${votes === 1 ? 'vote' : 'votes'})`}
          title={voted ? 'Take your vote back (V)' : 'Vote (V)'}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onVote?.() }}
        >
          <VoteIcon width={16} height={16} aria-hidden="true" /><span aria-hidden="true">{votes}</span>
        </button>
      ) : votes > 0 && (
        <span className="bd-vote-badge" aria-hidden="true"><VoteIcon width={14} height={14} />{votes}</span>
      )}
      {editing && <Editor kind={item.kind} field={field} value={item.data[field] ?? ''} marks={item.kind === 'note' ? normalizeMarks(item.data.text, item.data.marks) : undefined} onCommit={commit} onCancel={() => done(true)} onDraft={saveDraft} />}
      {handles && editable && list.map((h) => (
        <span key={h} aria-hidden="true" className={`bd-handle bd-h-${h}`} onPointerDown={(e) => onResizeStart?.(e, h)} />
      ))}
    </div>
  )
}

// Textarea laid over the item. Esc cancels; blur or Cmd/Ctrl+Enter commits.
// Typed text is saved only when the typing pauses (a note is usually one request, a long one two or three), and never more than
// 15 s apart while someone types without a break: every save is a write and a broadcast to the whole board.
const DRAFT_IDLE_MS = 3000
const DRAFT_MAX_MS = 15000

function Editor({ kind, field, value, marks: initialMarks, onCommit, onCancel, onDraft }) {
  const markable = initialMarks !== undefined // notes: words in the box can be highlighted
  const [text, setText] = useState(value)
  const [marks, setMarks] = useState(initialMarks ?? [])
  const [sel, setSel] = useState(null) // the selected stretch, in characters, while there is one
  const el = useRef(null)
  const back = useRef(null)
  const original = useRef(value) // what the editor opened with: the item's own value changes once a draft is sent
  const originalMarks = useRef(initialMarks)
  const latest = useRef(value) // what is in the box now
  const latestMarks = useRef(initialMarks)
  const saved = useRef(value) // what was last sent (the value the editor opened with, until a draft goes out)
  const savedMarks = useRef(initialMarks)
  const timer = useRef(null)
  const dirtySince = useRef(null) // when the text first differed from what was last sent
  const draft = useRef(onDraft)
  draft.current = onDraft
  const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  const flush = () => {
    clearTimeout(timer.current)
    timer.current = null
    dirtySince.current = null
    if (draft.current && (latest.current !== saved.current || !same(latestMarks.current, savedMarks.current))) {
      saved.current = latest.current
      savedMarks.current = latestMarks.current
      draft.current(latest.current, latestMarks.current)
    }
  }
  const queueDraft = () => {
    if (!draft.current) return
    const now = Date.now()
    dirtySince.current ??= now
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, Math.max(0, Math.min(DRAFT_IDLE_MS, dirtySince.current + DRAFT_MAX_MS - now)))
  }
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') flush() } // leaving the tab: send it now
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', flush)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', flush); clearTimeout(timer.current) }
  }, [])
  const cancelled = useRef(false)
  const openedAt = useRef(Date.now())
  const asked = useRef(false) // the user asked to finish (Cmd+Enter), so a blur is a real commit
  useLayoutEffect(() => {
    const t = el.current
    t.focus()
    // A frame's default title is meant to be typed over; for other text the caret goes to the end.
    t.setSelectionRange(field === 'title' ? 0 : t.value.length, t.value.length)
  }, [])
  const stop = (e) => e.stopPropagation()
  // Puts a colour on the selected words, or takes the highlight off (null, or the same colour again). The words keep their
  // selection so another colour can follow.
  const mark = (color) => {
    if (!sel) return
    const next = applyMark(latestMarks.current, sel.s, sel.e, color, charLength(latest.current))
    latestMarks.current = next
    setMarks(next)
    queueDraft()
    el.current?.focus()
  }
  return (
    <>
      {markable && (
        // The highlights drawn behind the (see-through) box: the same text in the same place, its own colour hidden.
        <div ref={back} className={`bd-editor bd-editor-${kind} bd-editor-back`} aria-hidden="true">
          {segments(text, marks).map((s, i) => (s.color ? <mark key={i} className={`bd-mark bd-mark-${s.color}`}>{s.text}</mark> : s.text))}
        </div>
      )}
      <textarea
        ref={el}
        className={`bd-editor bd-editor-${kind}${markable ? ' has-marks' : ''}`}
        value={text}
        maxLength={MAX_LEN[field] ?? 2000}
        aria-label={EDITOR_LABEL[field] ?? 'Item text'}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value
          if (markable) { const next = rebaseMarks(latest.current, v, latestMarks.current); latestMarks.current = next; setMarks(next) }
          setText(v)
          latest.current = v
          queueDraft()
        }}
        onSelect={markable ? (e) => {
          const t = e.currentTarget
          const s = toCharIndex(t.value, t.selectionStart)
          const en = toCharIndex(t.value, t.selectionEnd)
          setSel(en > s ? { s, e: en } : null)
        } : undefined}
        onScroll={markable ? (e) => { if (back.current) back.current.scrollTop = e.currentTarget.scrollTop } : undefined}
        onPointerDown={stop}
        onDoubleClick={stop}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') { cancelled.current = true; clearTimeout(timer.current); timer.current = null; if (draft.current && (saved.current !== original.current || !same(savedMarks.current, originalMarks.current))) draft.current(original.current, originalMarks.current); onCancel() } // Esc puts back
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || field === 'title')) { e.preventDefault(); asked.current = true; e.currentTarget.blur() }
        }}
        onBlur={() => {
          if (cancelled.current) return
          // The click that created the item still has its own focus change to deliver (touch sends it late):
          // taking focus back is better than closing the editor the moment it opens.
          if (!asked.current && Date.now() - openedAt.current < 350) { setTimeout(() => el.current?.focus(), 0); return }
          clearTimeout(timer.current)
          timer.current = null
          onCommit(text, asked.current, markable ? latestMarks.current : undefined)
        }}
      />
      {markable && sel && (
        <div className="bd-markbar" role="toolbar" aria-label="Highlight the selected words" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }} onDoubleClick={stop}>
          {MARK_COLORS.map((c) => (
            <button key={c} type="button" className={`bd-markbtn bd-mark-${c}`} aria-label={`Highlight in ${c}`} title={`Highlight in ${c}`} onClick={() => mark(c)} />
          ))}
          <button type="button" className="bd-markbtn bd-markbtn--clear" aria-label="Remove the highlight" title="Remove the highlight" onClick={() => mark(null)}>×</button>
        </div>
      )}
    </>
  )
}

// Positions change on every pointer move while dragging, so an item whose own props are unchanged skips the render.
// The callbacks are deliberately not compared: the canvas builds them to read its latest state at call time.
const same = (a, b) => a.item === b.item && a.selected === b.selected && a.editable === b.editable && a.peerMoving === b.peerMoving
  && a.handles === b.handles && a.autoEdit === b.autoEdit && a.linking === b.linking && a.label === b.label
  && a.votes === b.votes && a.voted === b.voted && a.voting === b.voting
export default memo(ItemView, same)
