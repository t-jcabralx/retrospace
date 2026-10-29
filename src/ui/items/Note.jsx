'use client'
// A sticky note. A note is a fixed size, so a long text scrolls inside it (mouse wheel or trackpad over the note) and, when it
// does not all fit, a "Read all" button opens the whole text in a dialog: that is the way on a phone, where a touch on a note
// drags it instead of scrolling it.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { noteColor } from '../ops.js'
import { useModal } from '../boards/useModal.js'
import { copyText } from '../boards/CopyButton.jsx'

const BEHIND = '.bd-top, .bd-board, .bd-panel-screen, .bd-zoom, .ev, .bd-wall, .bd-retro'

function Reader({ text, author, openerRef, onClose }) {
  const root = useRef(null)
  const id = useId()
  const [copied, setCopied] = useState(null)
  useModal(root, onClose, openerRef, { inert: BEHIND })
  return createPortal(
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={root} className="bd-reader" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="bd-reader-head">
          <h2 id={id}>{author ? `Note by ${author}` : 'Note'}</h2>
          <button type="button" className="bd-sbtn" data-autofocus onClick={onClose}>Close</button>
        </header>
        <div className="bd-reader-text" tabIndex={0}>{text}</div>
        <div className="bd-reader-foot">
          <button type="button" className="bd-sbtn" onClick={async () => { setCopied(await copyText(text)); setTimeout(() => setCopied(null), 2000) }}>{copied === true ? 'Copied' : copied === false ? 'Copy failed' : 'Copy the text'}</button>
        </div>
      </div>
    </>,
    document.body,
  )
}

export default function Note({ item, editing, readOnly }) {
  const text = item.data.text
  const box = useRef(null)
  const btn = useRef(null)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState(false)

  // Does the text fit? Measured again whenever the note is resized or its text changes.
  useLayoutEffect(() => {
    const el = box.current
    if (!el || editing) return undefined
    const measure = () => setOver(el.scrollHeight > el.clientHeight + 2)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text, editing, item.w, item.h])
  useEffect(() => { if (editing) setOpen(false) }, [editing])

  return (
    <div className="bd-note-wrap">
      <div ref={box} className={`bd-note${over || item.anon ? ' has-foot' : ''}`} style={{ background: noteColor(item.data.color) }}>
        {!editing && (text ? <p className="bd-body-text">{text}</p> : !readOnly && <p className="bd-placeholder">Double-click to write</p>)}
      </div>
      {over && !editing && (
        <button
          ref={btn} type="button" className="bd-readall" aria-haspopup="dialog" aria-label="Read the whole note"
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        >Read all</button>
      )}
      {open && <Reader text={text} author={item.anon ? '' : item.authorName} openerRef={btn} onClose={() => setOpen(false)} />}
    </div>
  )
}
