'use client'
// The Summary panel: a right-hand dialog like the settings drawer (focus moves in and stays in, Esc closes, the board behind
// is inert, focus goes back to the Summary button). The owner reads, edits, shares and deletes the summary here and can
// ask for an AI-written draft; everyone else sees only a summary the owner has shared, as plain text.
import { useId, useRef } from 'react'
import { useModal } from './boards/useModal.js'
import { CloseIcon } from './icons.jsx'
import SummaryOwner from './SummaryOwner.jsx'
import CopyButton from './boards/CopyButton.jsx'
import { sourceLabel } from './summaryApi.js'
import './site/site.css'
import './settings.css'
import './summary.css'

const BEHIND = '.bd-top, .bd-board'

function GuestSummary({ summary }) {
  if (!summary) return <p className="bd-sum-empty" role="status">No summary is shared right now.</p>
  return (
    <>
      <p className="bd-sum-source">{sourceLabel(summary)}</p>
      <div className="bd-sum-text" role="region" aria-label="Summary text" tabIndex={0}>{summary.text}</div>
      <div className="bd-set-actions"><CopyButton text={summary.text} label="Copy" ariaLabel="Copy the summary" /></div>
    </>
  )
}

export default function SummaryPanel({ ctl, onClose, openerRef, onOpenSettings }) {
  const root = useRef(null)
  const titleId = useId()
  const guard = useRef(null) // the owner's editor: returns true when it asked "discard your changes?" instead of closing
  useModal(root, () => { if (!guard.current?.()) onClose() }, openerRef, { inert: BEHIND })

  return (
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={() => { if (!guard.current?.()) onClose() }} />
      <aside ref={root} className="bd-settings bd-sum" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="bd-settings-head">
          <h2 id={titleId}>Summary</h2>
          <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close summary" onClick={() => { if (!guard.current?.()) onClose() }}><CloseIcon /></button>
        </header>
        <div className="bd-settings-body">
          {ctl.isOwner ? <SummaryOwner ctl={ctl} guardRef={guard} onClose={onClose} onOpenSettings={onOpenSettings} /> : <GuestSummary summary={ctl.board.summary} />}
        </div>
      </aside>
    </>
  )
}
