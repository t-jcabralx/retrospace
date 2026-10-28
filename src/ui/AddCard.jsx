'use client'
// The "Add a card" button of a celebration board and the composer it opens. Hidden on other board types and while the board
// is read-only for this viewer (locked or closed); the server refuses those writes too.
import { useCallback, useRef, useState } from 'react'
import CardComposer from './CardComposer.jsx'
import './cards.css'

export default function AddCard({ ctl, onPosted }) {
  const [open, setOpen] = useState(false)
  const draft = useRef(null) // survives closing the dialog until the card is posted
  const button = useRef(null)
  const keep = useCallback((d) => { draft.current = d }, [])
  const close = useCallback(() => setOpen(false), [])
  if (ctl.board?.type !== 'celebration' || ctl.readOnly) return null
  return (
    <>
      <button ref={button} type="button" className="bd-addcard" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
        Add a card
      </button>
      {open && (
        <CardComposer
          ctl={ctl}
          items={ctl.items}
          draft={draft.current}
          onDraft={keep}
          onClose={close}
          openerRef={button}
          onPosted={(op) => { ctl.notify('Card added'); onPosted?.(op) }}
        />
      )}
    </>
  )
}
