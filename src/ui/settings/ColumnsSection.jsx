'use client'
// Retro and workshop boards: the board's columns (frames flagged data.col) as an editable list. Every change is a normal
// item op through ctl.local, so undo, live sync, presence and permissions behave as for any other edit on the canvas.
import { useEffect, useId, useRef, useState } from 'react'
import { Section, ConfirmStep } from './controls.jsx'
import { EmojiField, SaveTemplateForm } from '../ColumnsEditor.jsx'
import { MAX_COLUMNS, MAX_COLUMN_TITLE, validateColumns } from '../../lib/columns.js'
import { columnFrames, freeFrames, columnParts, retitleOp, moveColumnOps, addColumnOp, removeColumnOps, markAsColumnOp, freeColumnOp, canAddColumn } from '../columnOps.js'

function ColumnRow({ frame, index, count, ctl, say, onMove, askRemove, children }) {
  const parts = columnParts(frame)
  const [title, setTitle] = useState(parts.title)
  const [emoji, setEmoji] = useState(parts.emoji)
  const [problem, setProblem] = useState('')
  const id = useId()
  useEffect(() => { setTitle(parts.title); setEmoji(parts.emoji) }, [parts.title, parts.emoji])

  function commit(next = { title, emoji }) {
    const v = validateColumns([next])
    if (!v.ok) { setProblem(v.error[0].toUpperCase() + v.error.slice(1)); return }
    setProblem('')
    const [c] = v.columns
    setTitle(c.title)
    if (c.title === parts.title && c.emoji === parts.emoji) return
    if (ctl.local([retitleOp(frame, c)])) say(`Column renamed to ${c.title}`)
  }
  const label = parts.title || `column ${index + 1}`

  return (
    <li className="cs-set-item" data-colid={frame.id}>
      <EmojiField value={emoji} label={`emoji for ${label}`} invalid={Boolean(problem) && emoji !== ''} dataCtl="emoji" onChange={(e) => { setEmoji(e); commit({ title: title.trim() ? title : parts.title, emoji: e }) }} />
      <input
        className="cs-input" type="text" autoComplete="off" maxLength={MAX_COLUMN_TITLE} value={title} data-ctl="title"
        aria-label={`Title of ${label}`} aria-invalid={problem ? 'true' : undefined} aria-describedby={problem ? `${id}-e` : undefined}
        onChange={(e) => { setTitle(e.target.value); setProblem('') }}
        onBlur={() => commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
      <span className="cs-moves">
        <button type="button" className="cs-btn cs-btn--icon" data-ctl="left" aria-label={`Move ${label} left`} disabled={index === 0} onClick={() => onMove(frame.id, -1, 'left')}><span aria-hidden="true">←</span></button>
        <button type="button" className="cs-btn cs-btn--icon" data-ctl="right" aria-label={`Move ${label} right`} disabled={index === count - 1} onClick={() => onMove(frame.id, 1, 'right')}><span aria-hidden="true">→</span></button>
        <button type="button" className="cs-btn cs-btn--icon" aria-label={`Remove ${label}`} onClick={() => askRemove(frame.id)}><span aria-hidden="true">×</span></button>
      </span>
      {problem && <p className="cs-error" id={`${id}-e`} role="alert">{problem}</p>}
      {children}
    </li>
  )
}

export default function ColumnsSection({ ctl, board }) {
  const items = ctl.items
  const cols = columnFrames(items)
  const free = freeFrames(items)
  const [status, setStatus] = useState('')
  const [removing, setRemoving] = useState(null)
  const pendingFocus = useRef(null)
  const list = useRef(null)
  const say = (t) => setStatus(t)

  useEffect(() => {
    const f = pendingFocus.current
    if (!f) return
    pendingFocus.current = null
    const q = (ctlName) => list.current?.querySelector(`[data-colid="${CSS.escape(f.id)}"] [data-ctl="${ctlName}"]`)
    let el = q(f.ctl)
    if (!el || el.disabled) el = q(f.ctl === 'left' ? 'right' : 'left')
    el?.focus()
  }, [cols.map((c) => c.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  function move(id, dir, ctlName) {
    const ops = moveColumnOps(items, id, dir)
    if (!ops.length || !ctl.local(ops)) return
    pendingFocus.current = { id, ctl: ctlName }
    say(`Moved ${dir < 0 ? 'left' : 'right'}`)
  }
  function add() {
    const op = addColumnOp(items, { title: `Column ${cols.length + 1}` })
    if (!op || !ctl.local([op])) return
    say('Column added on the right')
    setTimeout(() => list.current?.querySelector(`[data-colid="${CSS.escape(op.id)}"] [data-ctl="title"]`)?.focus(), 50)
  }
  function remove(id) {
    const gone = cols.find((c) => c.id === id)
    setRemoving(null)
    if (gone && ctl.local(removeColumnOps(items, id))) say(`${columnParts(gone).title || 'Column'} removed. Notes inside stay on the board.`)
  }
  function toggleFree(frame, asColumn) {
    if (asColumn && !canAddColumn(items)) { say(`A board can have at most ${MAX_COLUMNS} columns.`); return }
    if (ctl.local([asColumn ? markAsColumnOp(frame) : freeColumnOp(frame)])) say(asColumn ? 'Frame is now a column' : 'Column is now a free frame')
  }

  return (
    <Section title="Columns" hint="Rename, reorder, add or remove the columns of this board. Notes inside a column move with it.">
      {cols.length === 0 && <p className="cs-note">This board has no columns yet. Add one, or turn a frame you drew into a column below.</p>}
      <ul className="cs-set-list" ref={list} aria-label="Board columns">
        {cols.map((c, i) => (
          <ColumnRow key={c.id} frame={c} index={i} count={cols.length} ctl={ctl} say={say} onMove={move} askRemove={setRemoving}>
            {removing === c.id && (
              <div className="cs-set-confirm">
                <ConfirmStep message="Remove this column? Notes inside stay on the board." confirmLabel="Remove column" onConfirm={() => remove(c.id)} onCancel={() => setRemoving(null)} />
              </div>
            )}
          </ColumnRow>
        ))}
      </ul>
      <div className="cs-bar">
        <button type="button" className="cs-btn" onClick={add} disabled={!canAddColumn(items)}>+ Add column</button>
        <span className="cs-count">{cols.length} of {MAX_COLUMNS}{!canAddColumn(items) ? ' (maximum)' : ''}</span>
      </div>
      <p className="cs-vh" role="status" aria-live="polite">{status}</p>
      {(free.length > 0 || cols.length > 0) && (
        <details className="cs-adv">
          <summary className="cs-label">Frames and columns</summary>
          {free.length > 0 && (
            <ul className="cs-set-list" aria-label="Frames you drew">
              {free.map((f) => (
                <li key={f.id} className="cs-mine-item">
                  <span className="cs-mine-name">{f.data.title || 'Untitled frame'}</span>
                  <button type="button" className="cs-btn" onClick={() => toggleFree(f, true)} disabled={!canAddColumn(items)}>Use as column<span className="cs-vh">: {f.data.title}</span></button>
                </li>
              ))}
            </ul>
          )}
          {cols.length > 0 && <p className="cs-hint">A column can go back to being a free frame; its notes and title stay.</p>}
          <ul className="cs-set-list" aria-label="Columns as frames">
            {cols.map((c) => (
              <li key={c.id} className="cs-mine-item">
                <span className="cs-mine-name">{c.data.title}</span>
                <button type="button" className="cs-btn" onClick={() => toggleFree(c, false)}>Make a free frame<span className="cs-vh">: {c.data.title}</span></button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {cols.length > 0 && <SaveTemplateForm type={board.type === 'retro' ? 'retro' : 'workshop'} getColumns={() => cols.map((c) => { const p = columnParts(c); return { title: p.title, emoji: p.emoji } })} />}
    </Section>
  )
}
