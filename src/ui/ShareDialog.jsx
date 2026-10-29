'use client'
// "Scan to join or open a link": a QR code, the link and the code for any board, for the owner to show on a screen or send.
import { useId, useRef, useState } from 'react'
import { useModal } from './boards/useModal.js'
import { copyText } from './boards/CopyButton.jsx'
import JoinQr from './JoinQr.jsx'
import { CloseIcon } from './icons.jsx'
import './share.css'

const BEHIND = '.bd-top, .bd-board, .bd-panel-screen, .bd-zoom, .ev, .bd-wall, .bd-retro'

function CopyRow({ label, value, copyLabel }) {
  const [state, setState] = useState(null)
  return (
    <div className="bd-share-row">
      <div className="bd-share-val"><span className="bd-share-lab">{label}</span><code>{value}</code></div>
      <button type="button" className="bd-sbtn" aria-label={copyLabel} onClick={async () => { setState(await copyText(value)); setTimeout(() => setState(null), 2000) }}>{state === true ? 'Copied' : state === false ? 'Copy failed' : 'Copy'}</button>
    </div>
  )
}

export default function ShareDialog({ code, title, openerRef, onClose }) {
  const root = useRef(null)
  const id = useId()
  useModal(root, onClose, openerRef, { inert: BEHIND })
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/join?code=${encodeURIComponent(code)}`
  return (
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={root} className="bd-share" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="bd-share-head">
          <h2 id={id}>Invite people</h2>
          <button type="button" className="bd-iconbtn" aria-label="Close" data-autofocus onClick={onClose}><CloseIcon /></button>
        </header>
        <p className="bd-share-lede">Scan the code with a phone camera, or open the link. {title ? `They join “${title}”.` : ''} No account is needed.</p>
        <JoinQr code={code} />
        <CopyRow label="Link" value={link} copyLabel="Copy the join link" />
        <CopyRow label="Code" value={code} copyLabel="Copy the board code" />
        <p className="bd-share-hint">Tip: show this on a projector so everyone can scan it. If you set a passcode, share that separately.</p>
      </div>
    </>
  )
}
