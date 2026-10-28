'use client'
// Top-bar "Export" button with a menu: PNG picture of the board (anyone who can see it), CSV spreadsheet (owner only; a plain
// link so the session cookie goes with it), and Print / Save as PDF, which only appears when a `printHref` is given.
import { useEffect, useId, useRef, useState } from 'react'
import { exportPng, ExportError } from './exportPng.js'
import './owner-tools.css'

export const csvHref = (code, authors) => `/api/boards/${encodeURIComponent(code)}/export?format=csv${authors ? '&authors=1' : ''}`

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </svg>
)

export default function ExportMenu({ ctl, title, printHref }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authors, setAuthors] = useState(false) // names people chose are never exported unless the owner asks
  const [status, setStatus] = useState('')
  const root = useRef(null)
  const toggle = useRef(null)
  const items = useRef([])
  const menuId = useId()
  const noteId = useId()
  const isOwner = Boolean(ctl.isOwner)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  useEffect(() => { if (open) items.current.find(Boolean)?.focus() }, [open])

  async function savePng() {
    if (busy) return
    setBusy(true)
    setOpen(false)
    setStatus('Preparing the picture…')
    try {
      const canvas = document.querySelector('.bd-canvas:not(.bd-export-host)')
      const r = await exportPng(canvas, ctl.items, { title })
      if (alive.current) setStatus(`Saved ${r.filename}`)
    } catch (e) {
      const message = e instanceof ExportError ? e.message : 'The picture could not be made. Try again.'
      if (alive.current) setStatus('')
      ctl.notify?.(message)
    } finally {
      if (alive.current) setBusy(false)
    }
    toggle.current?.focus()
  }

  const moveFocus = (e) => {
    const list = items.current.filter(Boolean)
    const i = list.indexOf(document.activeElement)
    const to = { ArrowDown: (i + 1) % list.length, ArrowUp: (i + list.length - 1) % list.length, Home: 0, End: list.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    list[to]?.focus()
  }

  let n = 0
  const slot = () => { const k = n++; return (el) => { items.current[k] = el } }

  return (
    <div
      ref={root}
      className="bd-export"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); toggle.current?.focus() }
        else if (open) moveFocus(e)
      }}
      onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget)) setOpen(false) }}
    >
      <button
        ref={toggle}
        type="button"
        className="bd-iconbtn bd-export-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Export this board"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
      >
        <DownloadIcon /><span className="bd-export-btn-label">{busy ? 'Preparing…' : 'Export'}</span>
      </button>
      <span className="bd-vh" role="status" aria-live="polite">{status}</span>
      {open && (
        <div id={menuId} className="bd-export-menu" role="menu" aria-label="Export">
          <button ref={slot()} type="button" role="menuitem" tabIndex={-1} className="bd-export-item" disabled={busy} onClick={savePng}>PNG picture</button>
          {isOwner && (
            <>
              <a
                ref={slot()}
                role="menuitem"
                tabIndex={-1}
                className="bd-export-item"
                href={csvHref(ctl.code, authors)}
                download
                onClick={() => { setOpen(false); setStatus('Your CSV download has started.'); toggle.current?.focus() }}
              >
                CSV spreadsheet
              </a>
              <button
                ref={slot()}
                type="button"
                role="menuitemcheckbox"
                aria-checked={authors}
                aria-describedby={noteId}
                tabIndex={-1}
                className="bd-export-item bd-export-opt"
                onClick={() => setAuthors((a) => !a)}
              >
                <span className={`bd-export-box${authors ? ' is-on' : ''}`} aria-hidden="true">{authors ? '✓' : ''}</span>
                <span>Include author names<small id={noteId}>Author names are the anonymous names people chose.</small></span>
              </button>
            </>
          )}
          {printHref && (
            <a ref={slot()} role="menuitem" tabIndex={-1} className="bd-export-item" href={printHref} target="_blank" rel="noopener" onClick={() => setOpen(false)}>Print / Save as PDF</a>
          )}
        </div>
      )}
    </div>
  )
}
