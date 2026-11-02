import Link from 'next/link'
import PageShell from '../../ui/site/PageShell.jsx'
import './support.css'

export const metadata = {
  title: 'Support Retrospace',
  description: 'Retrospace is free to use. If it helps you, you can chip in toward keeping it running by scanning a QR code.',
  alternates: { canonical: '/support' },
}

// A plain page with the payment QR. The image is a file in public/support: replace it to change where support goes.
export default function SupportPage() {
  return (
    <PageShell>
      <article className="rs-wrap sp">
        <h1>Support Retrospace</h1>
        <p className="sp-intro">Retrospace is free to use. If it helps your team and you would like to chip in toward keeping it running, you can send any amount by scanning this QR code. It is entirely optional, and nothing on the site depends on it.</p>
        <figure className="sp-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed QR code: it must reach the scanner exactly as it is, so it is not resized or re-encoded */}
          <img className="sp-qr" src="/support/payment-qr.jpg" width="357" height="362" alt="QR code for sending support to Retrospace. Scan it with GCash or any bank or e-wallet app that supports InstaPay QR." />
          <figcaption>Open GCash (or your bank or e-wallet app), choose <b>Scan QR</b>, and scan the code above.</figcaption>
        </figure>
        <p className="sp-thanks">Thank you. Using Retrospace and telling a friend helps just as much.</p>
        <p className="sp-back"><Link href="/">Back to home</Link></p>
      </article>
    </PageShell>
  )
}
