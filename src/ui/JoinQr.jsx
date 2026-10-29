'use client'
// A QR code that opens the join page with the board code filled in, for a projector or a printed sign. The code is drawn in the
// browser (nothing is sent anywhere) as black on white so phones scan it in any theme.
import { useEffect, useState } from 'react'
import './share.css'

export default function JoinQr({ code, compact = false }) {
  const [src, setSrc] = useState('')
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    const link = `${window.location.origin}/join?code=${encodeURIComponent(code)}`
    setUrl(link)
    import('qrcode').then((m) => (m.default ?? m).toDataURL(link, { margin: 2, width: compact ? 200 : 280, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })).then((d) => { if (live) setSrc(d) }).catch(() => {})
    return () => { live = false }
  }, [code, compact])
  return (
    <figure className={`ev-qr${compact ? ' is-compact' : ''}`}>
      {src ? <img src={src} alt={`QR code to join with the code ${code}`} width={compact ? 200 : 280} height={compact ? 200 : 280} /> : <span className="ev-qr-wait">Making the code…</span>}
      <figcaption>Scan to join, or go to <strong>{url.replace(/^https?:\/\//, '').replace(/\/join.*$/, '')}</strong> and enter <strong className="ev-code">{code}</strong></figcaption>
    </figure>
  )
}
