'use client'
// The "please support Retrospace" pop-up, shown at the end of a board. A bottom sheet on a phone, a centred dialog on a tablet and
// a wider two-column dialog on a computer. It holds a pleading GIF, a few kind words, the payment QR (with a way to save it, since
// a phone cannot scan its own screen) and a link to the support page. Esc, the scrim and "Maybe later" close it. Focus starts on
// the close button at the top, so a tall sheet opens showing its top, not scrolled down to a button.
import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useModal } from './boards/useModal.js'
import { CloseIcon } from './icons.jsx'
import { gifUrl, pickGif } from '../lib/supportPrompt.js'
import './support-modal.css'

const BEHIND = '.bd-top, .bd-board, .bd-panel-screen, .ev'

export default function SupportModal({ onClose, onNever, gif }) {
  const root = useRef(null)
  const titleId = useId()
  const descId = useId()
  const [id] = useState(() => gif ?? pickGif())
  const [gifOk, setGifOk] = useState(true)
  useModal(root, onClose, null, { inert: BEHIND })

  return (
    <>
      <div className="sm-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={root} className="sm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1}>
        <button type="button" className="sm-x" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        <div className="sm-body">
          <div className="sm-copy">
            {gifOk && (
              // eslint-disable-next-line @next/next/no-img-element -- a Giphy GIF loaded straight from Giphy; it is decoration, so the pop-up works without it
              <img className="sm-gif" src={gifUrl(id)} alt="" referrerPolicy="no-referrer" onError={() => setGifOk(false)} />
            )}
            <h2 id={titleId}>Please support Retrospace 🥺</h2>
            <p id={descId}>Thanks for using Retrospace! It is free, but hosting, the database and upkeep cost money every month. If it helped your team today, a small amount toward web maintenance would mean a lot. It is entirely optional.</p>
          </div>
          <div className="sm-pay">
            <figure className="sm-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed QR code must reach the scanner exactly as it is */}
              <img className="sm-qr" src="/support/payment-qr.jpg" width="357" height="362" alt="QR code for sending support to Retrospace. Scan it with GCash or any bank or e-wallet app that supports InstaPay QR." />
              <figcaption>Scan with GCash or any InstaPay QR app</figcaption>
            </figure>
            <div className="sm-actions">
              <a className="rs-btn rs-btn--primary rs-btn--block" href="/support/payment-qr.jpg" download="retrospace-support-qr.jpg">Save the QR to pay from this device</a>
              <Link className="rs-btn rs-btn--secondary rs-btn--block" href="/support" target="_blank" rel="noopener">How to support</Link>
              <button type="button" className="sm-later" onClick={onClose}>Maybe later</button>
              <button type="button" className="sm-never" onClick={onNever}>Don&rsquo;t show this again</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
