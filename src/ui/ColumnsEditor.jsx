'use client'
// The column editor of the New-board dialog (and its building blocks, which Settings → Columns reuses): an editable
// list (rename, emoji, reorder by buttons, keyboard or drag, remove, add up to 8), a live mini preview and the owner's
// saved templates. Everything here is controlled by `rows` ({ key, title, emoji }, see lib/columnsEdit.js).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './columns.css'
import { MAX_COLUMNS, MAX_COLUMN_TITLE, MAX_HEADER, DEFAULT_HEADER, presetColumns, joinTitle } from '../lib/columns.js'
import { withKeys, stripKeys, moveRow, reorderRow, updateRow, removeRow, addRow, canAdd, rowProblems } from '../lib/columnsEdit.js'
import { isSingleEmoji } from '../lib/emoji.js'
import { getTemplate } from '../lib/templates.js'
import { listTemplates, saveTemplate, deleteTemplate, templateMessage } from './templatesClient.js'

const QUICK_EMOJI = ['✅', '⚠️', '🚧', '💡', '🔥', '🎯', '👍', '👎', '❓', '❤️', '🚀', '🐛', '📌', '😀', '😡', '😢']

// Text field for exactly one emoji (or nothing), with a few quick picks. `label` names it for assistive tech.
export function EmojiField({ value, onChange, label, disabled, invalid, id, dataCtl }) {
  const pick = useRef(null)
  return (
    <span className="cs-emoji">
      <input
        id={id} className="cs-input cs-emoji-input" type="text" inputMode="text" autoComplete="off" spellCheck="false" maxLength={16} placeholder="🙂"
        value={value} disabled={disabled} aria-label={label} aria-invalid={invalid ? 'true' : undefined} data-ctl={dataCtl}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      <details
        className="cs-pick" ref={pick}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !pick.current?.open) return
          e.preventDefault() // closes the picker only, not the dialog around it
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          pick.current.open = false
          pick.current.querySelector('summary')?.focus()
        }}
      >
        <summary className="cs-btn cs-btn--icon" aria-label={`Pick an emoji for ${label}`}><span aria-hidden="true">▾</span></summary>
        <div className="cs-pick-pop" role="group" aria-label="Emoji choices">
          {QUICK_EMOJI.map((e) => (
            <button key={e} type="button" className="cs-pick-btn" aria-label={`Use ${e}`} onClick={() => { onChange(e); if (pick.current) pick.current.open = false }}>{e}</button>
          ))}
          <button type="button" className="cs-btn cs-pick-none" onClick={() => { onChange(''); if (pick.current) pick.current.open = false }}>No emoji</button>
        </div>
      </details>
    </span>
  )
}

// A scaled-down picture of the board: the instruction header over one box per column, left to right.
export function ColumnsPreview({ rows, header }) {
  return (
    <figure className="cs-preview" aria-label={`Preview of the board layout: ${rows.length} ${rows.length === 1 ? 'column' : 'columns'}`}>
      {header !== undefined && <div className="cs-pv-header" aria-hidden="true">{header || DEFAULT_HEADER}</div>}
      <div className="cs-pv-cols" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.key} className="cs-pv-col" title={joinTitle(r)}>
            <span className="cs-pv-title">{r.emoji && <span>{r.emoji}</span>}{r.title}</span>
            <span className="cs-pv-note" /><span className="cs-pv-note is-short" />
          </div>
        ))}
      </div>
    </figure>
  )
}

export function ColumnList({ rows, onRows, showErrors, idBase }) {
  const [status, setStatus] = useState('')
  const [dragFrom, setDragFrom] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const focusAfter = useRef(null)
  const list = useRef(null)
  const problems = showErrors ? rowProblems(rows) : null
  const emojiBad = (r) => r.emoji !== '' && !isSingleEmoji(r.emoji)

  useEffect(() => {
    const f = focusAfter.current
    if (!f || !list.current) return
    focusAfter.current = null
    const find = (key, ctl) => list.current.querySelector(`[data-rowkey="${CSS.escape(key)}"] [data-ctl="${ctl}"]`)
    let el = f.key ? find(f.key, f.ctl) : null
    if (el?.disabled) el = find(f.key, f.ctl === 'down' ? 'up' : 'down') ?? el
    if (!el || el.disabled) el = list.current.querySelector('[data-ctl="title"]')
    el?.focus()
  }, [rows])

  const move = (i, dir, ctl) => {
    const next = moveRow(rows, i, dir)
    if (next === rows) return
    focusAfter.current = { key: rows[i].key, ctl }
    setStatus(`${rows[i].title || 'Column'} moved to position ${i + dir + 1} of ${rows.length}`)
    onRows(next)
  }
  const remove = (i) => {
    if (rows.length <= 1) return
    const near = rows[i + 1] ?? rows[i - 1]
    focusAfter.current = { key: near.key, ctl: 'title' }
    setStatus(`${rows[i].title || 'Column'} removed`)
    onRows(removeRow(rows, i))
  }
  const add = () => {
    const next = addRow(rows)
    focusAfter.current = { key: next.at(-1).key, ctl: 'title' }
    setStatus(`Column ${next.length} added`)
    onRows(next)
  }

  return (
    <div>
      <ul className="cs-list" ref={list} aria-label="Columns">
        {rows.map((r, i) => (
          <li
            key={r.key} data-rowkey={r.key} className={`cs-row${dragFrom === i ? ' is-dragging' : ''}${overIndex === i && dragFrom !== null && dragFrom !== i ? ' is-over' : ''}`}
            onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setOverIndex(i) } }}
            onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) { onRows(reorderRow(rows, dragFrom, i)); setStatus(`${rows[dragFrom].title || 'Column'} moved to position ${i + 1} of ${rows.length}`) } setDragFrom(null); setOverIndex(null) }}
          >
            <button
              type="button" className="cs-btn cs-btn--icon cs-handle" data-ctl="handle" draggable
              aria-label={`Reorder ${r.title || `column ${i + 1}`}, position ${i + 1} of ${rows.length}. Arrow Up and Arrow Down move it; you can also drag.`}
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
              onDragEnd={() => { setDragFrom(null); setOverIndex(null) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1, 'handle') }
                else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(i, 1, 'handle') }
              }}
            ><span aria-hidden="true">⠿</span></button>
            <EmojiField
              value={r.emoji} label={`emoji for column ${i + 1}`} invalid={emojiBad(r)} dataCtl="emoji"
              onChange={(emoji) => onRows(updateRow(rows, i, { emoji }))}
            />
            <input
              className="cs-input cs-title" type="text" autoComplete="off" maxLength={MAX_COLUMN_TITLE} value={r.title} data-ctl="title"
              aria-label={`Title of column ${i + 1}`} placeholder="Column title" data-autofocus={i === 0 ? '' : undefined}
              aria-invalid={emojiBad(r) || problems?.[i] ? 'true' : undefined} aria-describedby={problems?.[i] || emojiBad(r) ? `${idBase}-e${r.key}` : undefined}
              onChange={(e) => onRows(updateRow(rows, i, { title: e.target.value }))}
            />
            <span className="cs-moves">
              <button type="button" className="cs-btn cs-btn--icon" data-ctl="up" aria-label={`Move ${r.title || `column ${i + 1}`} up`} disabled={i === 0} onClick={() => move(i, -1, 'up')}><span aria-hidden="true">↑</span></button>
              <button type="button" className="cs-btn cs-btn--icon" data-ctl="down" aria-label={`Move ${r.title || `column ${i + 1}`} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1, 'down')}><span aria-hidden="true">↓</span></button>
              <button type="button" className="cs-btn cs-btn--icon" data-ctl="remove" aria-label={`Remove ${r.title || `column ${i + 1}`}`} disabled={rows.length <= 1} onClick={() => remove(i)}><span aria-hidden="true">×</span></button>
            </span>
            {(problems?.[i] || emojiBad(r)) && <p className="cs-error" id={`${idBase}-e${r.key}`}>{emojiBad(r) ? 'The emoji must be exactly one emoji, or empty.' : problems[i]}</p>}
          </li>
        ))}
      </ul>
      <p className="cs-vh" role="status" aria-live="polite">{status}</p>
      <div className="cs-bar">
        <button type="button" className="cs-btn" onClick={add} disabled={!canAdd(rows)}>+ Add column</button>
        <span className="cs-count">{rows.length} of {MAX_COLUMNS}{!canAdd(rows) ? ' (maximum)' : ''}</span>
      </div>
    </div>
  )
}

// Name + "Save" for the owner's saved templates. `getColumns()` returns the rows to save (or null when invalid).
export function SaveTemplateForm({ type, getColumns, onSaved }) {
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ kind: '', text: '' })
  async function submit(e) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    const columns = getColumns()
    if (!columns) { setMsg({ kind: 'error', text: 'Fix the columns above first.' }); return }
    if (!name.trim()) { setMsg({ kind: 'error', text: 'Give the template a name.' }); return }
    setBusy(true)
    const r = await saveTemplate({ name, type, columns })
    setBusy(false)
    if (r.ok && r.data?.template) { setName(''); setMsg({ kind: 'ok', text: `Saved “${r.data.template.name}”.` }); onSaved?.(r.data.template); return }
    setMsg({ kind: 'error', text: templateMessage(r, 'Could not save the template.') })
  }
  return (
    <div className="cs-save" role="group" aria-label="Save these columns as a template">
      <label className="cs-label" htmlFor={`${id}-n`}>Save these columns as a template</label>
      <div className="cs-save-row">
        <input id={`${id}-n`} className="cs-input" type="text" autoComplete="off" maxLength={40} placeholder="Template name" value={name} disabled={busy}
          onChange={(e) => { setName(e.target.value); setMsg({ kind: '', text: '' }) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(e) }} />
        <button type="button" className="cs-btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save template'}</button>
      </div>
      <p className={`cs-note${msg.kind === 'error' ? ' is-error' : ''}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>
    </div>
  )
}

// The owner's saved templates: use one (replaces the rows) or delete it.
export function SavedTemplates({ onUse, refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, items: [], error: '' })
  const [confirm, setConfirm] = useState(null)
  useEffect(() => {
    let live = true
    listTemplates().then((r) => {
      if (live) setState(r.ok ? { loading: false, items: r.data.templates ?? [], error: '' } : { loading: false, items: [], error: r.status === 401 ? '' : templateMessage(r, 'Could not load your templates.') })
    })
    return () => { live = false }
  }, [refreshKey])
  async function remove(t) {
    const r = await deleteTemplate(t.id)
    setConfirm(null)
    if (r.ok || r.status === 404) setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== t.id) }))
    else setState((s) => ({ ...s, error: templateMessage(r, 'Could not delete the template.') }))
  }
  if (state.loading) return <p className="cs-note">Loading your templates…</p>
  return (
    <div className="cs-mine">
      <p className="cs-label" id="cs-mine-h">My templates</p>
      {state.error && <p className="cs-note is-error" role="alert">{state.error}</p>}
      {state.items.length === 0 && !state.error && <p className="cs-note">Nothing saved yet. Save the columns below to reuse them on your next board.</p>}
      <ul className="cs-mine-list" aria-labelledby="cs-mine-h">
        {state.items.map((t) => (
          <li key={t.id} className="cs-mine-item">
            <span className="cs-mine-name">{t.name}<span className="cs-mine-sub">{t.columns.length} {t.columns.length === 1 ? 'column' : 'columns'}</span></span>
            {confirm === t.id ? (
              <span className="cs-mine-act" role="group" aria-label={`Delete ${t.name}?`}>
                <button type="button" className="cs-btn" onClick={() => setConfirm(null)}>Keep</button>
                <button type="button" className="cs-btn cs-btn--danger" onClick={() => remove(t)}>Delete</button>
              </span>
            ) : (
              <span className="cs-mine-act">
                <button type="button" className="cs-btn" onClick={() => onUse(t)}>Use<span className="cs-vh"> {t.name}</span></button>
                <button type="button" className="cs-btn cs-btn--icon" aria-label={`Delete template ${t.name}`} onClick={() => setConfirm(t.id)}><span aria-hidden="true">×</span></button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// The whole step. `value` is { rows, header } or null until the person changes something (then the template's own
// columns are shown and sent as-is). `onChange(next | null)`.
export default function ColumnsEditor({ type, templateKey, value, onChange, showErrors }) {
  const idBase = useId()
  const preset = useMemo(() => withKeys(getTemplate(type, templateKey)?.columns ?? presetColumns('blank')), [type, templateKey])
  const rows = value?.rows ?? preset
  const header = type === 'retro' ? (value?.header ?? DEFAULT_HEADER) : undefined
  const [refresh, setRefresh] = useState(0)
  const set = (next) => onChange({ rows: next, header: value?.header })
  const getColumns = () => (rowProblems(rows) ? null : stripKeys(rows))

  return (
    <div className="cs-editor">
      <p className="cs-lead">Each column is a frame on the board. Notes inside a column stay with it. You can change all of this later in Settings.</p>
      <ColumnsPreview rows={rows} header={header} />
      <ColumnList rows={rows} onRows={set} showErrors={showErrors} idBase={idBase} />
      {type === 'retro' && (
        <div className="cs-field">
          <label className="cs-label" htmlFor={`${idBase}-h`}>Header text</label>
          <input id={`${idBase}-h`} className="cs-input" type="text" autoComplete="off" maxLength={MAX_HEADER} value={header}
            onChange={(e) => onChange({ rows, header: e.target.value })} />
          <p className="cs-hint">Shown above the columns. It is a normal text item, so you can edit it on the board too.</p>
        </div>
      )}
      <div className="cs-bar">
        <button type="button" className="cs-btn" onClick={() => onChange(null)}>Reset to template</button>
        <button type="button" className="cs-btn" onClick={() => onChange({ rows: withKeys(presetColumns('blank')), header: value?.header })}>Blank (3 empty columns)</button>
      </div>
      <SavedTemplates refreshKey={refresh} onUse={(t) => onChange({ rows: withKeys(t.columns), header: value?.header })} />
      <SaveTemplateForm type={type === 'retro' ? 'retro' : 'workshop'} getColumns={getColumns} onSaved={() => setRefresh((n) => n + 1)} />
    </div>
  )
}
