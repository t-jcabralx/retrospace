'use client'
// The Highlights panel: a right-hand dialog like Summary. The highlighted notes, the most-voted of the rest and the follow-up
// actions in one list, with a button that copies it as plain text. Built from the same document the print page uses, without
// author names (they are only ever added by the owner's choice on the print page).
import { useId, useMemo, useRef, useState } from 'react'
import { useModal } from './boards/useModal.js'
import { copyText } from './boards/CopyButton.jsx'
import { CloseIcon } from './icons.jsx'
import { buildPrintModel } from '../lib/printModel.js'
import { highlightsText } from '../lib/highlight.js'
import './site/site.css'
import './settings.css'
import './summary.css'

const BEHIND = '.bd-top, .bd-board'
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

function Group({ title, note, list, mark }) {
  if (!list.length) return null
  return (
    <section className="bd-hl-group" aria-label={title}>
      <h3>{title}</h3>
      {note && <p className="bd-hl-note">{note}</p>}
      <ul className="bd-hl-list">
        {list.map((r) => (
          <li key={r.id}>
            <span className="bd-hl-mark" aria-hidden="true">{mark}</span>
            <span className="bd-hl-text">{r.text}</span>
            {r.votes > 0 && <span className="bd-hl-votes">{plural(r.votes, 'vote')}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function HighlightsPanel({ ctl, onClose, openerRef, printHref }) {
  const root = useRef(null)
  const titleId = useId()
  const [copied, setCopied] = useState(null)
  useModal(root, onClose, openerRef, { inert: BEHIND })
  const model = useMemo(() => buildPrintModel(ctl.board, ctl.items, [], { authors: false }), [ctl.board, ctl.items])
  const h = model.highlights

  async function copy() {
    setCopied(await copyText(highlightsText(model.cover.title, h)))
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={root} className="bd-settings bd-sum" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="bd-settings-head">
          <h2 id={titleId}>Highlights</h2>
          <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close highlights" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="bd-settings-body">
          {h ? (
            <>
              <Group title="Highlighted" list={h.highlighted} mark="★" />
              <Group title="Most voted" note="The notes with the most votes that are not highlighted." list={h.top} mark="•" />
              <Group title="Action items" list={h.actions} mark="☐" />
              <div className="bd-set-actions">
                <button type="button" className="bd-sbtn" data-autofocus onClick={copy}>{copied === true ? 'Copied' : copied === false ? 'Copy failed' : 'Copy as text'}</button>
                {printHref && <a className="bd-sbtn" href={printHref} target="_blank" rel="noopener">Open the printable version</a>}
              </div>
            </>
          ) : (
            <p className="bd-sum-empty" role="status">Nothing is highlighted yet. Select a note and press the star (or H) to highlight it. Notes with votes and action items show up here too.</p>
          )}
        </div>
      </aside>
    </>
  )
}
